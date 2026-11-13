import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { finalizeSourceObservation, readSourceDiagnostics, recordSourceObservation, sourceObservation } from "./local-news-source-diagnostics";
import type { SourceDiagnostics, SourceObservation } from "../shared/local-news-source-diagnostics";
import path from "node:path";
import { z } from "zod";
import { detectLocalNewsSensitiveContent, hashLocalNewsCanonicalEventIdentity, hashLocalNewsQueueReview, hashLocalNewsReviewValue, runLocalNewsReviewCommittee } from "./clippers-local-news-review-committee";
import { buildLocalNewsGrowthPackage, type LocalNewsGrowthPackage, type LocalNewsGrowthVariantId } from "./clippers-local-news-growth";
import { detectLocalNewsLanguage, getDefaultLocalNewsTranslator, type LocalNewsTranslator } from "./clippers-local-news-translation";
import { getLocalNewsGrowthScoutPattern } from "./local-news-growth-scout";
import { archiveAndCompactLocalNewsState } from "./clippers-local-news-state-retention";
import { mirrorOfficeSourceFile } from "./office-source-document-sync";

export type ClipperLocalNewsLane = "miami-news" | "ny-news";
export type ClipperLocalNewsPlatform = "x" | "facebook";
export type ClipperLocalNewsRisk = "low" | "medium" | "high" | "critical";
export type ClipperLocalNewsLifecycle = "active" | "resolved";
export type ClipperLocalNewsQueueStatus = "approval_required" | "auto_eligible" | "quarantined" | "rejected";
export type ClipperLocalNewsSection = "traffic" | "weather" | "breaking" | "public_safety" | "local";
export type ClipperLocalNewsTopicTag = "violent_crime" | "kidnapping" | "immigration" | null;
export type ClipperLocalNewsEditorialUrgency = "routine" | "developing" | "breaking";
export type ClipperLocalNewsRevisionKind = "original" | "update" | "resolved" | "correction";
export type ClipperLocalNewsCommitteeRole = "source_verifier" | "safety_editor" | "monetization_editor";
export type ClipperLocalNewsCommitteeVerdict = "approve" | "quarantine" | "reject";
export type ClipperLocalNewsPublishDecision = "auto_publish" | "quarantine" | "reject";

export interface ClipperLocalNewsCommitteeReview {
  role: ClipperLocalNewsCommitteeRole;
  verdict: ClipperLocalNewsCommitteeVerdict;
  reasons: string[];
  evidence: string[];
  checkedAt: string;
}

export interface ClipperLocalNewsRawEvent {
  id?: string;
  sourceEventId?: string;
  source?: string;
  sourceUrl?: string;
  lane?: ClipperLocalNewsLane;
  title?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  location?: string;
  areaDesc?: string;
  severity?: string;
  urgency?: string;
  certainty?: string;
  eventType?: string;
  effective?: string;
  expires?: string;
  status?: string;
  active?: boolean;
  properties?: Record<string, unknown>;
  /** Public media published by the verified source (never an arbitrary scrape). */
  mediaUrl?: string;
  mediaType?: "image" | "video";
  provenance?: ClipperLocalNewsProvenance;
  [key: string]: unknown;
}

export interface ClipperLocalNewsProvenance {
  connectorId: string;
  canonicalHost: string;
  fetchedAt: string;
  claimHash: string;
  verified: boolean;
  sensitiveEligible: boolean;
}

export interface ClipperLocalNewsEvent {
  originalPublishedAt?: string | null;
  id: string;
  sourceEventId: string;
  source: string;
  sourceUrl: string;
  lane: ClipperLocalNewsLane;
  title: string;
  description: string;
  instruction: string;
  location: string;
  eventType: string;
  severity: string;
  urgency: string;
  certainty: string;
  risk: ClipperLocalNewsRisk;
  lifecycle: ClipperLocalNewsLifecycle;
  effective: string | null;
  expires: string | null;
  firstSeenAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  revision: number;
  fingerprint: string;
  section: ClipperLocalNewsSection;
  topicTag: ClipperLocalNewsTopicTag;
  editorialUrgency: ClipperLocalNewsEditorialUrgency;
  editorialPriority: number;
  revisionKind: ClipperLocalNewsRevisionKind;
  provenance: ClipperLocalNewsProvenance | null;
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
  qualityScore: number;
}

export interface ClipperLocalNewsQueueItem {
  originalPublishedAt?: string | null;
  id: string;
  eventId: string;
  eventRevision: number;
  canonicalEventIdentity: string;
  claimIdentityHash: string;
  lane: ClipperLocalNewsLane;
  platform: ClipperLocalNewsPlatform;
  copy: string;
  source: string;
  sourceUrl: string;
  risk: ClipperLocalNewsRisk;
  lifecycle: ClipperLocalNewsLifecycle;
  status: ClipperLocalNewsQueueStatus;
  approvalRequired: boolean;
  autoEligible: boolean;
  published: false;
  createdAt: string;
  section: ClipperLocalNewsSection;
  topicTag: ClipperLocalNewsTopicTag;
  editorialUrgency: ClipperLocalNewsEditorialUrgency;
  editorialPriority: number;
  revisionKind: ClipperLocalNewsRevisionKind;
  textOnly: boolean;
  mediaRequired: boolean;
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
  qualityScore: number;
  gateReason: "none" | "risk" | "operator_opt_out" | "cadence" | "committee_quarantine" | "committee_reject";
  notBefore: string | null;
  verdicts: ClipperLocalNewsCommitteeReview[];
  evidence: string[];
  consensus: "unanimous_approve" | "not_unanimous";
  publishDecision: ClipperLocalNewsPublishDecision;
  reasons: string[];
  checkedAt: string;
  reviewHash: string;
  organicGrowth?: LocalNewsGrowthPackage;
}

export interface ClipperLocalNewsMetricInput {
  queueItemId?: string;
  eventId?: string;
  lane: ClipperLocalNewsLane;
  platform: ClipperLocalNewsPlatform;
  impressions?: number;
  reach?: number;
  videoViews?: number;
  engagements?: number;
  clicks?: number;
  shares?: number;
  revenueUsd?: number;
  costUsd?: number;
  observedAt?: string;
  variantId?: LocalNewsGrowthVariantId;
}

export interface ClipperLocalNewsMetric extends Required<Omit<ClipperLocalNewsMetricInput, "queueItemId" | "eventId" | "observedAt" | "variantId">> {
  id: string;
  queueItemId: string | null;
  eventId: string | null;
  observedAt: string;
  recordedAt: string;
  variantId: LocalNewsGrowthVariantId | null;
}

export interface ClipperLocalNewsStatus {
  sourceDiagnostics: SourceDiagnostics;
  workspaceDir: string;
  bootstrapped: boolean;
  scheduleMinutes: number;
  lastRunAt: string | null;
  lanes: Record<ClipperLocalNewsLane, { active: number; resolved: number; queued: number }>;
  events: { total: number; active: number; resolved: number };
  queue: { total: number; approvalRequired: number; autoEligible: number; quarantined: number; rejected: number; published: 0 };
  editorial: {
    owner: "Local News CEO";
    operatingMode: "professional_newsroom";
    sections: Record<ClipperLocalNewsSection, { events: number; queued: number }>;
    urgency: Record<ClipperLocalNewsEditorialUrgency, number>;
    autoSafe: number;
    reviewRequired: number;
    cadenceHeld: number;
    textOnlyFacebook: number;
    duplicates: number;
    revisions: number;
    corrections: number;
    resolvedRevisions: number;
    cadence: { windowMinutes: 60; facebookPerLane: 6; facebookRoutinePerLane: 2; xPerLane: 8; xRoutinePerLane: 3; facebookRelevantMax: 10; adaptive: "urgency_and_observed_performance" };
    committee: { reviewed: number; unanimous: number; quarantined: number; rejected: number; roles: ClipperLocalNewsCommitteeRole[] };
    growth: { mode: "zero_cost_organic"; paidAds: false; paidAiPerPost: true; ownedLinks: number; experiments: number; shortFormReady: number; sourceVideos: number; sourceImages: number; highQuality: number; videoFirst: true; localTranslation: { mode: "hosted_openai_nano_batched"; estimatedMonthlyApiCostUsd: number; requiredInProduction: true } };
    dailyPublishing: { minimumPerAccount: 10; adaptiveMaximum: 14; bilingualSamePost: true; videoFirst: true; accounts: Record<ClipperLocalNewsLane, Record<ClipperLocalNewsPlatform, { queuedToday: number; target: 10 | 12 | 14; deficit: number; performanceMode: "baseline" | "growing" | "breakout" }>> };
  };
  metrics: { total: number; impressions: number; reach: number; videoViews: number; engagements: number; clicks: number; shares: number; revenueUsd: number; costUsd: number; profitUsd: number };
  monetization: {
    targetUsd: 10000;
    revenueUsd: number;
    remainingUsd: number;
    progressPct: number;
    externalEligibility: "unverified";
    pagesEligible: null;
    policyViolations: null;
    verifiedAt: null;
    bySection: Partial<Record<ClipperLocalNewsSection, { posts: number; reach: number; engagement: number; revenueUsd: number }>>;
  };
  connectors: Array<{ id: string; lane: ClipperLocalNewsLane; configured: boolean; requiresKey: boolean; public: boolean }>;
  coverage: {
    weather: "nws_public";
    miamiTraffic: "public_incident_feed" | "configured_feed" | "not_configured";
    nyTraffic: "notify_nyc_public" | "ny511_configured" | "not_configured";
    roadCoverageComplete: false;
    note: string;
  };
  artifacts: Record<string, string>;
  guardrails: string[];
}

export interface ClipperLocalNewsOptions {
  workspaceDir?: string;
  now?: string | Date;
  env?: NodeJS.ProcessEnv;
  translator?: LocalNewsTranslator;
}

export interface ClipperLocalNewsIngestInput extends ClipperLocalNewsOptions {
  events: ClipperLocalNewsRawEvent[];
  resolveMissing?: boolean;
  snapshotLanes?: ClipperLocalNewsLane[];
}

export interface ClipperLocalNewsCycleInput extends ClipperLocalNewsOptions {
  events?: ClipperLocalNewsRawEvent[];
  fetch?: typeof globalThis.fetch;
  officialFeedTextFallback?: (source: { id: string; url: string }) => Promise<string | null>;
  resolveMissing?: boolean;
  snapshotLanes?: ClipperLocalNewsLane[];
}

export interface ClipperLocalNewsMetricsInput extends ClipperLocalNewsOptions {
  metrics: ClipperLocalNewsMetricInput[];
}

interface LocalNewsState {
  version: 1;
  bootstrappedAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  scheduleMinutes: number;
  events: ClipperLocalNewsEvent[];
  queue: ClipperLocalNewsQueueItem[];
  metrics: ClipperLocalNewsMetric[];
  editorialCounters?: { duplicates: number; revisions: number; corrections: number; resolvedRevisions: number; cadenceHeld: number };
}

const LANES: ClipperLocalNewsLane[] = ["miami-news", "ny-news"];
const PLATFORMS: ClipperLocalNewsPlatform[] = ["x", "facebook"];
const MAX_BATCH_SIZE = 500;
const SECTIONS: ClipperLocalNewsSection[] = ["traffic", "weather", "breaking", "public_safety", "local"];
const EDITORIAL_URGENCIES: ClipperLocalNewsEditorialUrgency[] = ["routine", "developing", "breaking"];
const CADENCE = { windowMinutes: 60 as const, facebookPerLane: 6 as const, facebookRoutinePerLane: 2 as const, xPerLane: 8 as const, xRoutinePerLane: 3 as const };
const FACEBOOK_MAX_RELEVANT_PER_LANE = 10;
const MONETIZATION_TARGET_USD = 10_000;
const RSS_STALE_MS = 72 * 60 * 60_000;
const SENSITIVE_OFFICIAL_RSS_STALE_MS = 7 * 24 * 60 * 60_000;
const RSS_FUTURE_SKEW_MS = 6 * 60 * 60_000;
const ARCGIS_STALE_MS = 48 * 60 * 60_000;
const MIAMI_TRANSIT_LOOKBACK_MS = 120 * 24 * 60 * 60_000;
const MIAMI_TRANSIT_MAX_ACTIVE = 20;
const FACEBOOK_DETAIL_LIMIT = 700;
const FACEBOOK_FEED_DETAIL_LIMIT = 260;
const FACEBOOK_FEED_ACTION_LIMIT = 180;
const TRANSLATION_TITLE_LIMIT = 500;
const PUBLIC_SNAPSHOT_MAX_BYTES = 3 * 1024 * 1024;
const PUBLIC_SNAPSHOT_MAX_QUEUE_ITEMS = 600;
const verifiedFetchedEvents = new WeakSet<object>();
const DEFAULT_WORKSPACE = path.join(process.cwd(), "clippers_workspace", "local-news");
const FILES = {
  state: "state.json",
  publicSnapshot: "public-news-snapshot.json",
  events: "events.json",
  queue: "metricool-queue.json",
  queueCsv: "metricool-queue.csv",
  analytics: "analytics.json",
  analyticsCsv: "analytics.csv",
  growth: "organic-growth.json",
  runbook: "RUNBOOK.md",
  sources: "SOURCE_SETUP.md",
} as const;

function workspace(options?: ClipperLocalNewsOptions): string {
  return path.resolve(options?.workspaceDir || options?.env?.CLIPPERS_LOCAL_NEWS_WORKSPACE || process.env.CLIPPERS_LOCAL_NEWS_WORKSPACE || DEFAULT_WORKSPACE);
}

function isoNow(value?: string | Date): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error("Invalid now value");
  return date.toISOString();
}

function clean(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : fallback;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ").trim();
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function urlHost(value: string): string {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ""; }
}

function attachVerifiedProvenance(raw: ClipperLocalNewsRawEvent, source: SourceDefinition, fetchedAt: string): ClipperLocalNewsRawEvent {
  const sourceUrl = clean(raw.sourceUrl, source.url);
  raw.provenance = {
    connectorId: source.id,
    canonicalHost: urlHost(sourceUrl),
    fetchedAt,
    claimHash: digest(JSON.stringify([raw.sourceEventId, raw.title, raw.description, raw.instruction, raw.location, raw.eventType, sourceUrl])),
    verified: true,
    sensitiveEligible: source.sensitiveEligible === true,
  };
  verifiedFetchedEvents.add(raw);
  return raw;
}

function safeUrl(value: unknown, fallback: string): string {
  const candidate = clean(value);
  if (!candidate) return fallback;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function riskFor(input: { severity: string; urgency: string; title: string; eventType: string; description?: string; instruction?: string; location?: string }): ClipperLocalNewsRisk {
  const text = `${input.severity} ${input.urgency} ${input.title} ${input.eventType} ${input.description || ""} ${input.instruction || ""} ${input.location || ""}`.toLowerCase();
  if (/extreme|catastrophic|tornado emergency|hurricane warning|flash flood emergency|evacuat|\bdeath\b|\bdead\b|fatalit|fallecid|muerte|tiroteo|shooting|homicid|asesinat/.test(text)) return "critical";
  if (/severe|immediate|warning|tornado|hurricane|flash flood|life[- ]threat|arrest|detenid|acusad|charged|indict|\bcrime\b|crimen|delito|robbery|burglary|assault|rape|sexual|kidnap|secuestr|\bminor child\b|\bmenor(?:es)?\b|victim|víctima|violence|violencia|human traffick|tr[aá]fico de personas|smuggl|contraband|coyote|deport|ice arrest|cbp seizure|rumou?r|rumor|unconfirmed|no confirmado|sin confirmar|identified as|identificad[oa] como|named as/.test(text)) return "high";
  if (/moderate|expected|watch|flood|storm|snow|traffic|closure|crash|incident/.test(text)) return "medium";
  return "low";
}

function sectionFor(input: { title: string; eventType: string; description: string; source: string }): ClipperLocalNewsSection {
  const text = `${input.title} ${input.eventType} ${input.description} ${input.source}`.toLowerCase();
  if (/police|fire|public safety|seguridad p[uú]blica|emergency|rescue|missing person|shelter|federal bureau of investigation|\bfbi\b|department of justice|u\.s\. attorney|arrest|detenid|acusad|charged|indict|homicid|murder|killer|asesinat|matanza|mass shooting|carjacking|home invasion|robbery|assault|kidnap|secuestr|human traffick|tr[aá]fico de personas|smuggl|contraband|coyote|immigration|inmigraci[oó]n|immigrant|inmigrante|migrant|migrante|asylum|asilo|deport|border patrol|\bice\b|\bcbp\b|uscis|detention|detenci[oó]n/.test(text)) return "public_safety";
  if (/traffic|tr[aá]nsito|road|route|highway|street|bridge|tunnel|closure|closed|reopened|crash|collision|congestion|lane|subway|transit|\btrains?\b|metropolitan transportation authority|mta|fhp|fl511|511ny/.test(text)) return "traffic";
  if (/weather|nws|storm|\brain\b|flood|snow|wind|heat|cold|hurricane|tornado|thunder|coastal/.test(text)) return "weather";
  if (/breaking|urgent|urgente|ultima hora|última hora/.test(text)) return "breaking";
  return "local";
}

function editorialUrgencyFor(input: { risk: ClipperLocalNewsRisk; section: ClipperLocalNewsSection; title: string; eventType: string; urgency: string; lifecycle: ClipperLocalNewsLifecycle }): ClipperLocalNewsEditorialUrgency {
  const text = `${input.title} ${input.eventType} ${input.urgency}`.toLowerCase();
  if (input.risk === "critical" || /breaking|urgent|urgente|immediate|emergency|última hora|ultima hora/.test(text)) return "breaking";
  if (input.lifecycle === "resolved") return "routine";
  if (input.risk === "high" || input.risk === "medium" || input.section === "traffic" || input.section === "weather") return "developing";
  return "routine";
}

function topicTagFor(input: { title: string; eventType: string; description: string; source: string }): ClipperLocalNewsTopicTag {
  const text = `${input.title} ${input.eventType} ${input.description} ${input.source}`.toLowerCase();
  if (/kidnap|secuestr|abduct|rapto|missing child|ni[ñn]o desaparecid/.test(text)) return "kidnapping";
  if (/murder|killer|homicid|asesinat|matanza|mass shooting|carjacking|home invasion|robbery|burglary|assault|rape|tiroteo|shooting|human traffick|tr[aá]fico de personas|smuggl|contraband|coyote/.test(text)) return "violent_crime";
  if (/immigration|inmigraci[oó]n|immigrant|inmigrante|migrant|migrante|asylum|asilo|deport|border patrol|\bice\b|\bcbp\b|uscis|detention|detenci[oó]n/.test(text)) return "immigration";
  return null;
}

function editorialPriorityFor(input: { risk: ClipperLocalNewsRisk; section: ClipperLocalNewsSection; topicTag?: ClipperLocalNewsTopicTag; editorialUrgency: ClipperLocalNewsEditorialUrgency; lifecycle: ClipperLocalNewsLifecycle }): number {
  const risk = { low: 0, medium: 15, high: 35, critical: 50 }[input.risk];
  const section = { traffic: 0, weather: 15, local: 20, public_safety: 35, breaking: 40 }[input.section];
  const topic = { violent_crime: 15, kidnapping: 15, immigration: 10, null: 0 }[input.topicTag ?? "null"];
  const urgency = { routine: 0, developing: 10, breaking: 20 }[input.editorialUrgency];
  return Math.max(0, Math.min(100, 10 + risk + section + topic + urgency - (input.lifecycle === "resolved" ? 15 : 0)));
}

function mediaTypeFor(value: unknown): "image" | "video" | null {
  const text = clean(value).toLowerCase();
  if (!text) return null;
  if (/video|\.mp4(?:$|[?#])|\.mov(?:$|[?#])|\.m3u8(?:$|[?#])/.test(text)) return "video";
  if (/image|\.(?:jpe?g|png|webp|gif)(?:$|[?#])/.test(text)) return "image";
  return null;
}

function mediaUrlFor(raw: ClipperLocalNewsRawEvent, props: Record<string, unknown>, verified: boolean): { url: string | null; type: "image" | "video" | null } {
  if (!verified) return { url: null, type: null };
  const candidate = raw.mediaUrl || props.mediaUrl || props.media_url || props.videoUrl || props.video_url || props.imageUrl || props.image_url;
  const url = candidate ? safeUrl(candidate, "") : "";
  if (!url) return { url: null, type: null };
  const type = raw.mediaType || mediaTypeFor(props.mediaType) || mediaTypeFor(props.media_type) || mediaTypeFor(url) || "image";
  return { url, type };
}

function qualityScoreFor(input: {
  provenanceVerified: boolean;
  title: string;
  description: string;
  instruction: string;
  editorialUrgency: ClipperLocalNewsEditorialUrgency;
  lifecycle: ClipperLocalNewsLifecycle;
  mediaType: "image" | "video" | null;
}): number {
  let score = input.provenanceVerified ? 45 : 20;
  if (input.title.length >= 24) score += 8;
  if (input.description.length >= 80) score += 12;
  if (input.instruction.length >= 20) score += 5;
  if (input.editorialUrgency === "breaking") score += 12;
  else if (input.editorialUrgency === "developing") score += 6;
  if (input.lifecycle === "resolved") score -= 12;
  if (input.mediaType === "image") score += 12;
  if (input.mediaType === "video") score += 30;
  return Math.max(0, Math.min(100, score));
}

function revisionKindFor(raw: ClipperLocalNewsRawEvent, lifecycle: ClipperLocalNewsLifecycle): ClipperLocalNewsRevisionKind {
  if (lifecycle === "resolved") return "resolved";
  const text = `${clean(raw.status)} ${clean(raw.title || raw.headline)} ${clean(raw.eventType)}`.toLowerCase();
  return /correction|corrected|correcci[oó]n|corregid/.test(text) ? "correction" : "original";
}

function inferLane(raw: ClipperLocalNewsRawEvent, props: Record<string, unknown>): ClipperLocalNewsLane {
  if (raw.lane && LANES.includes(raw.lane)) return raw.lane;
  const text = `${clean(raw.location || raw.areaDesc || props.areaDesc)} ${clean(raw.source)} ${clean(raw.title || raw.headline || props.headline)}`.toLowerCase();
  return /miami|dade|broward|florida|\bfl\b/.test(text) ? "miami-news" : "ny-news";
}

function isResolved(raw: ClipperLocalNewsRawEvent, props: Record<string, unknown>, now: string): boolean {
  if (raw.active === false) return true;
  if (/\b(resolved|cleared|cancelled|canceled|expired|ended|reopened)\b/.test(clean(raw.status || props.status).toLowerCase())) return true;
  const expires = clean(raw.expires || props.expires || props.ends);
  if (!expires) return false;
  const expiresAt = new Date(expires).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= new Date(now).getTime();
}

export function normalizeClipperLocalNewsEvent(raw: ClipperLocalNewsRawEvent, now = isoNow()): Omit<ClipperLocalNewsEvent, "firstSeenAt" | "updatedAt" | "resolvedAt" | "revision"> {
  const props = raw.properties && typeof raw.properties === "object" ? raw.properties : {};
  const source = clean(raw.source || props.senderName || props.source, "public-feed");
  const sourceUrl = safeUrl(raw.sourceUrl || props.web || props.url || props.uri || raw.id, "https://www.weather.gov/");
  const sourceEventId = clean(raw.sourceEventId || props.id || raw.id) || digest(JSON.stringify([source, raw.title, raw.location, raw.effective]));
  const title = clean(raw.title || raw.headline || props.headline || props.event, "Local public update");
  const description = decodeXml(clean(raw.description || props.description));
  const instruction = decodeXml(clean(raw.instruction || props.instruction));
  const location = clean(raw.location || raw.areaDesc || props.areaDesc, inferLane(raw, props) === "miami-news" ? "Miami area" : "New York area");
  const eventType = clean(raw.eventType || props.event, title);
  const severity = clean(raw.severity || props.severity, "Unknown");
  const urgency = clean(raw.urgency || props.urgency, "Unknown");
  const certainty = clean(raw.certainty || props.certainty, "Unknown");
  const lane = inferLane(raw, props);
  const lifecycle: ClipperLocalNewsLifecycle = isResolved(raw, props, now) ? "resolved" : "active";
  const effective = clean(raw.effective || props.effective || props.sent) || null;
  const expires = clean(raw.expires || props.expires || props.ends) || null;
  const risk = riskFor({ severity, urgency, title, eventType, description, instruction, location });
  const section = sectionFor({ title, eventType, description, source });
  const topicTag = topicTagFor({ title, eventType, description, source });
  const editorialUrgency = editorialUrgencyFor({ risk, section, title, eventType, urgency, lifecycle });
  const editorialPriority = editorialPriorityFor({ risk, section, topicTag, editorialUrgency, lifecycle });
  const revisionKind = revisionKindFor(raw, lifecycle);
  const provenance = verifiedFetchedEvents.has(raw) && raw.provenance?.verified ? raw.provenance : null;
  const media = mediaUrlFor(raw, props, Boolean(provenance));
  const qualityScore = qualityScoreFor({ provenanceVerified: Boolean(provenance), title, description, instruction, editorialUrgency, lifecycle, mediaType: media.type });
  const fingerprint = digest(JSON.stringify({ title, description, instruction, location, eventType, severity, urgency, certainty, lifecycle, effective, expires, sourceUrl, section, topicTag, editorialUrgency, revisionKind, media, qualityScore, claimHash: provenance?.claimHash }));
  return { id: digest(`${source.toLowerCase()}|${sourceEventId.toLowerCase()}`), sourceEventId, source, sourceUrl, lane, title, description, instruction, location, eventType, severity, urgency, certainty, risk, lifecycle, effective, expires, fingerprint, section, topicTag, editorialUrgency, editorialPriority, revisionKind, provenance, mediaUrl: media.url, mediaType: media.type, qualityScore };
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit <= 1) return text.slice(0, limit);
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function englishPrefix(event: ClipperLocalNewsEvent): string {
  if (event.revisionKind === "correction") return "CORRECTION";
  if (event.lifecycle === "resolved") return "RESOLVED";
  if (event.editorialUrgency === "breaking") return "BREAKING";
  if (event.revision > 1) return "UPDATE";
  if (event.section === "traffic") return "TRAFFIC";
  if (event.section === "weather") return "WEATHER";
  if (event.section === "public_safety") return "PUBLIC SAFETY";
  return "LOCAL NEWS";
}

function xWeightedLength(text: string): number {
  const normalized = text.normalize("NFC");
  const urlPattern = /https?:\/\/\S+/g;
  const textWeight = (value: string): number => Array.from(value).reduce((total, character) => {
    const point = character.codePointAt(0) || 0;
    const singleWeight = (point >= 0 && point <= 4351)
      || (point >= 8192 && point <= 8205)
      || (point >= 8208 && point <= 8223)
      || (point >= 8242 && point <= 8247);
    return total + (singleWeight ? 1 : 2);
  }, 0);
  let total = 0;
  let cursor = 0;
  for (const match of normalized.matchAll(urlPattern)) {
    const index = match.index || 0;
    total += textWeight(normalized.slice(cursor, index)) + 23;
    cursor = index + match[0].length;
  }
  return total + textWeight(normalized.slice(cursor));
}

function truncateXWeighted(text: string, limit: number): string {
  const normalized = text.normalize("NFC");
  if (xWeightedLength(normalized) <= limit) return normalized;
  const suffix = ".";
  let output = "";
  for (const character of Array.from(normalized)) {
    if (xWeightedLength(output + character + suffix) > limit) break;
    output += character;
  }
  return `${output.trimEnd()}${suffix}`;
}

interface LocalNewsBilingualCopy {
  safe: boolean;
  issues: string[];
  es: { title: string; detail: string; instruction: string };
  en: { title: string; detail: string; instruction: string };
}

function localTranslationRequired(env: NodeJS.ProcessEnv, injected?: LocalNewsTranslator): boolean {
  if (env.NODE_ENV === "production") return true;
  const explicit = env.CLIPPERS_LOCAL_NEWS_LOCAL_TRANSLATION;
  if (explicit) return /^(1|true|yes)$/i.test(explicit);
  return Boolean(injected);
}

async function translateEventCopy(event: ClipperLocalNewsEvent, translator: LocalNewsTranslator): Promise<LocalNewsBilingualCopy> {
  const combined = `${event.title} ${event.description} ${event.instruction}`;
  const detectedSourceLanguage = detectLocalNewsLanguage(combined);
  const fallback = { title: event.title, detail: event.description, instruction: event.instruction };
  if (detectedSourceLanguage === "unknown") return { safe: false, issues: ["source_language_unknown"], es: fallback, en: fallback };
  const sourceLanguage = detectedSourceLanguage;
  const direction = sourceLanguage === "es" ? "es-en" as const : "en-es" as const;
  const suppliedFields = [
    ["title", event.title],
    ["detail", event.description],
    ["instruction", event.instruction],
  ] as const;
  const fieldLanguageIssues = suppliedFields.flatMap(([name, value]) => {
    if (!value?.trim()) return [];
    const detected = detectLocalNewsLanguage(value);
    return detected === sourceLanguage ? [] : [`source_field_language_mismatch:${name}:${detected}`];
  });
  if (fieldLanguageIssues.length > 0) return { safe: false, issues: fieldLanguageIssues, es: fallback, en: fallback };
  const sourceFallbacks = sourceLanguage === "es"
    ? ["La fuente oficial no proporcionó detalles adicionales.", "Consulta la fuente oficial antes de actuar."]
    : ["Official source provided no additional detail.", "Review the official source before taking action."];
  const fields = [
    truncate(event.title, TRANSLATION_TITLE_LIMIT),
    truncate(event.description || sourceFallbacks[0], FACEBOOK_DETAIL_LIMIT),
    truncate(event.instruction || sourceFallbacks[1], FACEBOOK_DETAIL_LIMIT),
  ];
  // One batched hosted request per story keeps translation cost and latency
  // bounded while the translator still validates every field independently.
  const translated = await translator.translateMany(fields, direction);
  const safe = translated.every((result) => result.safe && Boolean(result.translated));
  const issues = translated.flatMap((result) => result.issues);
  const target = translated.map((result) => result.translated || "");
  const original = { title: fields[0], detail: fields[1], instruction: fields[2] };
  const converted = { title: target[0], detail: target[1], instruction: target[2] };
  return sourceLanguage === "es"
    ? { safe, issues, es: original, en: converted }
    : { safe, issues, es: converted, en: original };
}

export function buildClipperLocalNewsCopy(event: ClipperLocalNewsEvent, platform: ClipperLocalNewsPlatform, growth?: LocalNewsGrowthPackage, bilingual?: LocalNewsBilingualCopy | null): string {
  const prefix = event.revisionKind === "correction" ? "CORRECCIÓN" : event.lifecycle === "resolved" ? "RESUELTO" : event.editorialUrgency === "breaking" ? "ÚLTIMA HORA" : event.revision > 1 ? "ACTUALIZACIÓN" : event.section === "traffic" ? "TRÁFICO" : event.section === "weather" ? "TIEMPO" : event.section === "public_safety" ? "SEGURIDAD PÚBLICA" : "NOTICIA LOCAL";
  const prefixEn = englishPrefix(event);
  const observedAt = event.effective || event.updatedAt;
  const timeEs = new Intl.DateTimeFormat("es-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(observedAt));
  const timeEn = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(observedAt));
  const headlineEs = bilingual?.safe ? bilingual.es.title : growth?.headline.es || event.title;
  const headlineEn = bilingual?.safe ? bilingual.en.title : growth?.headline.en || event.title;
  const detailEs = bilingual?.safe ? truncate(bilingual.es.detail, FACEBOOK_FEED_DETAIL_LIMIT) : `Actualización oficial para ${event.location} a las ${timeEs}.`;
  const detailEn = bilingual?.safe ? truncate(bilingual.en.detail, FACEBOOK_FEED_DETAIL_LIMIT) : `Official update for ${event.location} at ${timeEn}.`;
  const actionEs = bilingual?.safe ? truncate(bilingual.es.instruction, FACEBOOK_FEED_ACTION_LIMIT) : "Consulta la fuente oficial antes de actuar.";
  const actionEn = bilingual?.safe ? truncate(bilingual.en.instruction, FACEBOOK_FEED_ACTION_LIMIT) : "Review the official source before acting.";
  const ownedLink = growth?.ownedArticleUrl ? `\nContexto completo / Full context: ${growth.ownedArticleUrl}` : "";
  const tags = growth?.hashtags.length ? `\n${growth.hashtags.join(" ")}` : "";
  const sensitive = detectLocalNewsSensitiveContent(event).accusation;
  const legalEs = sensitive ? " Nota legal: una detención, acusación o cargo no equivale a culpabilidad; toda persona se presume inocente hasta que un tribunal determine lo contrario." : "";
  const legalEn = sensitive ? " Legal note: an arrest, accusation, or charge is not a conviction; every person is presumed innocent unless proven guilty in court." : "";
  if (platform === "x") {
    const legal = sensitive ? "\nES: Se presume inocente. EN: Presumed innocent." : "";
    const sourceLink = event.sourceUrl;
    // X must keep one complete, verified attribution URL. Hashtags are omitted
    // when space is constrained; the source is never sliced or partially emitted.
    const ending = `${legal}\nFuente / Source: ${sourceLink}`;
    const es = `ES — ${prefix}: ${headlineEs}. ${actionEs}`;
    const en = `EN — ${prefixEn}: ${headlineEn}. ${actionEn}`;
    const bilingualBudget = Math.max(3, 280 - xWeightedLength(ending));
    const spanishBudget = Math.max(1, Math.floor((bilingualBudget - 1) / 2));
    const englishBudget = Math.max(1, bilingualBudget - spanishBudget - 1);
    return `${truncateXWeighted(es, spanishBudget)}\n${truncateXWeighted(en, englishBudget)}${ending}`;
  }
  return `ESPAÑOL · ${prefix}\n${truncate(headlineEs, 220)}\n${detailEs}\n${actionEs}${legalEs}\n\nENGLISH · ${prefixEn}\n${truncate(headlineEn, 220)}\n${detailEn}\n${actionEn}${legalEn}\n\nFuente oficial / Official source: ${event.source}\n${event.sourceUrl}${ownedLink}${tags}`;
}

const rawEventSchema = z.object({
  id: z.string().max(2_000).optional(),
  sourceEventId: z.string().min(1).max(500).optional(),
  source: z.string().min(1).max(300).optional(),
  sourceUrl: z.string().url().max(2_000).optional(),
  lane: z.enum(LANES as [ClipperLocalNewsLane, ...ClipperLocalNewsLane[]]).optional(),
  title: z.string().max(1_000).optional(),
  headline: z.string().max(1_000).optional(),
  description: z.string().max(20_000).optional(),
  instruction: z.string().max(10_000).optional(),
  location: z.string().max(1_000).optional(),
  areaDesc: z.string().max(1_000).optional(),
  severity: z.string().max(100).optional(),
  urgency: z.string().max(100).optional(),
  certainty: z.string().max(100).optional(),
  eventType: z.string().max(500).optional(),
  effective: z.string().datetime({ offset: true }).optional(),
  expires: z.string().datetime({ offset: true }).optional(),
  status: z.string().max(100).optional(),
  active: z.boolean().optional(),
  mediaUrl: z.string().url().max(2_000).optional(),
  mediaType: z.enum(["image", "video"]).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const snapshotFieldsSchema = z.object({
  events: z.array(rawEventSchema).max(MAX_BATCH_SIZE),
  resolveMissing: z.boolean().optional(),
  snapshotLanes: z.array(z.enum(LANES as [ClipperLocalNewsLane, ...ClipperLocalNewsLane[]])).min(1).max(LANES.length).optional(),
}).superRefine((value, context) => {
  if (value.resolveMissing && !value.snapshotLanes?.length) context.addIssue({ code: "custom", path: ["snapshotLanes"], message: "snapshotLanes is required when resolveMissing is true" });
});
const ingestPayloadSchema = snapshotFieldsSchema;
const cyclePayloadSchema = z.object({
  events: z.array(rawEventSchema).max(MAX_BATCH_SIZE).optional(), resolveMissing: z.boolean().optional(),
  snapshotLanes: z.array(z.enum(LANES as [ClipperLocalNewsLane, ...ClipperLocalNewsLane[]])).min(1).max(LANES.length).optional(),
}).superRefine((value, context) => {
  if (value.resolveMissing && (value.events === undefined || !value.snapshotLanes?.length)) context.addIssue({ code: "custom", path: ["snapshotLanes"], message: "events and snapshotLanes are required when resolveMissing is true" });
});
const metricPayloadSchema = z.object({
  metrics: z.array(z.object({
    queueItemId: z.string().min(1).max(500).optional(), eventId: z.string().min(1).max(500).optional(),
    lane: z.enum(LANES as [ClipperLocalNewsLane, ...ClipperLocalNewsLane[]]), platform: z.enum(PLATFORMS as [ClipperLocalNewsPlatform, ...ClipperLocalNewsPlatform[]]),
    impressions: z.number().finite().nonnegative().optional(), reach: z.number().finite().nonnegative().optional(), videoViews: z.number().finite().nonnegative().optional(), engagements: z.number().finite().nonnegative().optional(), clicks: z.number().finite().nonnegative().optional(), shares: z.number().finite().nonnegative().optional(),
    revenueUsd: z.number().finite().nonnegative().optional(), costUsd: z.number().finite().nonnegative().optional(),
    observedAt: z.string().datetime({ offset: true }).optional(),
    variantId: z.enum(["utility", "impact"]).optional(),
  }).strict()).max(MAX_BATCH_SIZE),
});

function scheduleMinutes(env: NodeJS.ProcessEnv): number {
  const parsed = Number.parseInt(env.CLIPPERS_LOCAL_NEWS_INTERVAL_MINUTES || "3", 10);
  return Number.isFinite(parsed) ? Math.min(5, Math.max(2, parsed)) : 3;
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, file);
}

async function readState(dir: string): Promise<LocalNewsState | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, FILES.state), "utf8")) as LocalNewsState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv<T extends object>(rows: T[], columns: string[]): string {
  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvCell((row as Record<string, unknown>)[column])).join(",")).join("\n")}${rows.length ? "\n" : ""}`;
}

async function persist(dir: string, state: LocalNewsState): Promise<void> {
  const compacted = await archiveAndCompactLocalNewsState(dir, state, state.updatedAt);
  state.events = compacted.state.events;
  state.queue = compacted.state.queue;
  state.metrics = compacted.state.metrics;
  const analytics = summarizeMetrics(state.metrics);
  const queueColumns = ["id", "eventId", "eventRevision", "canonicalEventIdentity", "claimIdentityHash", "lane", "platform", "section", "topicTag", "editorialUrgency", "editorialPriority", "qualityScore", "revisionKind", "risk", "lifecycle", "status", "gateReason", "notBefore", "publishDecision", "consensus", "checkedAt", "reviewHash", "textOnly", "mediaRequired", "mediaType", "mediaUrl", "approvalRequired", "autoEligible", "published", "copy", "source", "sourceUrl", "createdAt"];
  const metricColumns = ["id", "queueItemId", "eventId", "lane", "platform", "variantId", "impressions", "reach", "videoViews", "engagements", "clicks", "shares", "revenueUsd", "costUsd", "observedAt", "recordedAt"];
  const rankedPublicCandidates = state.queue
    .filter((item) => item.status === "auto_eligible" && item.autoEligible && !item.approvalRequired)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const publicCandidates: ClipperLocalNewsQueueItem[] = [];
  const candidatesByLane = new Map(LANES.map((lane) => [lane, rankedPublicCandidates.filter((item) => item.lane === lane)]));
  for (let index = 0; publicCandidates.length < rankedPublicCandidates.length; index += 1) {
    let added = false;
    for (const lane of LANES) {
      const item = candidatesByLane.get(lane)?.[index];
      if (!item) continue;
      publicCandidates.push(item);
      added = true;
    }
    if (!added) break;
  }
  const eventById = new Map(state.events.map((event) => [event.id, event]));
  const publicQueue: ClipperLocalNewsQueueItem[] = [];
  const publicEvents: ClipperLocalNewsEvent[] = [];
  const publicEventIds = new Set<string>();
  let publicSnapshotBytes = 128;
  for (const item of publicCandidates) {
    if (publicQueue.length >= PUBLIC_SNAPSHOT_MAX_QUEUE_ITEMS) break;
    const event = eventById.get(item.eventId);
    if (!event) continue;
    const eventBytes = publicEventIds.has(event.id) ? 0 : Buffer.byteLength(JSON.stringify(event), "utf8") + 1;
    const itemBytes = Buffer.byteLength(JSON.stringify(item), "utf8") + 1;
    if (publicSnapshotBytes + eventBytes + itemBytes > PUBLIC_SNAPSHOT_MAX_BYTES) break;
    publicQueue.push(item);
    publicSnapshotBytes += itemBytes;
    if (!publicEventIds.has(event.id)) {
      publicEventIds.add(event.id);
      publicEvents.push(event);
      publicSnapshotBytes += eventBytes;
    }
  }
  const publicSnapshot = {
    version: 1,
    updatedAt: state.updatedAt,
    events: publicEvents,
    queue: publicQueue,
  };
  await Promise.all([
    atomicWrite(path.join(dir, FILES.state), `${JSON.stringify(state, null, 2)}\n`),
    atomicWrite(path.join(dir, FILES.publicSnapshot), `${JSON.stringify(publicSnapshot)}\n`),
    atomicWrite(path.join(dir, FILES.events), `${JSON.stringify({ generatedAt: state.updatedAt, events: state.events }, null, 2)}\n`),
    atomicWrite(path.join(dir, FILES.queue), `${JSON.stringify({ generatedAt: state.updatedAt, disclaimer: "Queue only; no real publication is claimed.", items: state.queue }, null, 2)}\n`),
    atomicWrite(path.join(dir, FILES.queueCsv), csv(state.queue, queueColumns)),
    atomicWrite(path.join(dir, FILES.analytics), `${JSON.stringify({ generatedAt: state.updatedAt, summary: analytics, metrics: state.metrics }, null, 2)}\n`),
    atomicWrite(path.join(dir, FILES.analyticsCsv), csv(state.metrics, metricColumns)),
    atomicWrite(path.join(dir, FILES.growth), `${JSON.stringify({
      generatedAt: state.updatedAt,
      costPolicy: { paidAds: false, paidAiPerPost: true, generation: "deterministic_local_templates", hostedTranslation: "gpt-5.4-nano_batched", estimatedMonthlyApiCostUsd: 0.5 },
      items: state.queue.filter((item) => item.organicGrowth).map((item) => ({ queueItemId: item.id, lane: item.lane, platform: item.platform, ...item.organicGrowth })),
    }, null, 2)}\n`),
  ]);
  mirrorOfficeSourceFile({ kind: "news_state", filePath: path.join(dir, FILES.state), raw: state });
}

function summarizeMetrics(metrics: ClipperLocalNewsMetric[]) {
  const totals = metrics.reduce((summary, metric) => ({ total: summary.total + 1, impressions: summary.impressions + metric.impressions, reach: summary.reach + (metric.reach || 0), videoViews: summary.videoViews + (metric.videoViews || 0), engagements: summary.engagements + metric.engagements, clicks: summary.clicks + metric.clicks, shares: summary.shares + metric.shares, revenueUsd: summary.revenueUsd + (metric.revenueUsd || 0), costUsd: summary.costUsd + (metric.costUsd || 0) }), { total: 0, impressions: 0, reach: 0, videoViews: 0, engagements: 0, clicks: 0, shares: 0, revenueUsd: 0, costUsd: 0 });
  const revenueUsd = Math.round(totals.revenueUsd * 100) / 100;
  const costUsd = Math.round(totals.costUsd * 100) / 100;
  return { ...totals, revenueUsd, costUsd, profitUsd: Math.round((revenueUsd - costUsd) * 100) / 100 };
}

function summarizeMetricsBySection(state: LocalNewsState | null): ClipperLocalNewsStatus["monetization"]["bySection"] {
  if (!state?.metrics.length) return {};
  const queueById = new Map(state.queue.map((item) => [item.id, item]));
  const eventByAnyId = new Map(state.events.flatMap((event) => [[event.id, event] as const, [event.sourceEventId, event] as const]));
  const summaries = new Map<ClipperLocalNewsSection, { postIds: Set<string>; reach: number; engagement: number; revenueUsd: number }>();
  for (const metric of state.metrics) {
    const queueItem = metric.queueItemId ? queueById.get(metric.queueItemId) : undefined;
    const event = metric.eventId ? eventByAnyId.get(metric.eventId) : queueItem ? eventByAnyId.get(queueItem.eventId) : undefined;
    const section = queueItem?.section || event?.section;
    if (!section) continue;
    const current = summaries.get(section) || { postIds: new Set<string>(), reach: 0, engagement: 0, revenueUsd: 0 };
    current.postIds.add(metric.queueItemId || metric.eventId || metric.id);
    current.reach += metric.reach || metric.impressions;
    current.engagement += metric.engagements;
    current.revenueUsd += metric.revenueUsd;
    summaries.set(section, current);
  }
  return Object.fromEntries([...summaries].map(([section, summary]) => [section, { posts: summary.postIds.size, reach: summary.reach, engagement: summary.engagement, revenueUsd: Math.round(summary.revenueUsd * 100) / 100 }]));
}

function easternDateKey(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function dailyPublishingStatus(state: LocalNewsState | null): ClipperLocalNewsStatus["editorial"]["dailyPublishing"] {
  const today = easternDateKey(state?.updatedAt || new Date().toISOString());
  const accounts = {} as ClipperLocalNewsStatus["editorial"]["dailyPublishing"]["accounts"];
  for (const lane of LANES) {
    accounts[lane] = {} as ClipperLocalNewsStatus["editorial"]["dailyPublishing"]["accounts"][ClipperLocalNewsLane];
    for (const platform of PLATFORMS) {
      const items = state?.queue.filter((item) => item.lane === lane && item.platform === platform && item.autoEligible && easternDateKey(item.createdAt) === today) || [];
      const decision = items.reduce<LocalNewsGrowthPackage["ceoDecision"] | undefined>((best, item) => {
        const candidate = item.organicGrowth?.ceoDecision;
        return !best || (candidate && candidate.dailyTargetPosts > best.dailyTargetPosts) ? candidate : best;
      }, undefined);
      const target = decision?.dailyTargetPosts || 10;
      accounts[lane][platform] = { queuedToday: items.length, target, deficit: Math.max(0, target - items.length), performanceMode: decision?.performanceMode || "baseline" };
    }
  }
  return { minimumPerAccount: 10, adaptiveMaximum: 14, bilingualSamePost: true, videoFirst: true, accounts };
}

function sourceSetup(): string {
  return `# Local News Source Setup\n\n- NWS: public, no API key. Only high-impact alerts for Miami and New York City survive the hot-news filter.\n- Miami-Dade County: official public news RSS, no API key.\n- Miami International Airport: official Latest News RSS; third-party “In the News” aggregation is intentionally excluded.\n- FBI Miami and New York: official public RSS for verified federal investigations and enforcement updates; sensitive accusations require the strengthened committee gate.\n- U.S. Attorney SDNY and SDFL: district-specific official DOJ press-release RSS; charges remain allegations and every accused person is presumed innocent unless a court rules otherwise.\n- Routine traffic sources (Notify NYC, FL511/FHP, NY511) are disabled by default. Set \`CLIPPERS_LOCAL_NEWS_INCLUDE_TRAFFIC=true\` only for an explicit traffic campaign.\n- Optional authorized news feeds: \`MIAMI_NEWS_FEED_URL\` and \`NY_NEWS_FEED_URL\`.\n- Webhook/manual ingestion: call the ingest function with attributed official/public events.\n\nOnly use official public or authorized feeds. Never copy commercial news articles. Keep secrets in environment variables. The default desk prioritizes verified crime, arrests, kidnapping, immigration, public-safety, and critical-weather updates.\n`;
}

function runbook(minutes: number): string {
  return `# Local News Agent Runbook\n\n1. The Local News CEO runs the desk every ${minutes} minutes (supported range: 2–5) using deterministic templates; no story is invented.\n2. Every social post carries substantive Spanish and English in the same publication. Translation reuses the configured OpenAI integration with gpt-5.4-nano, one batched request per new story, exact-input caching, and hard 500/700/700-character input caps. Estimated translation usage is capped operationally near $0.50/month; no separate membership is required.\n3. The hosted translator has a five-second request timeout, zero retries, a 10-request/minute ceiling, and a circuit breaker after the first provider failure. Missing credentials, timeout, ambiguous language, or changed/added URLs, numbers, times, routes, or other protected facts are quarantined and retried in a later cycle. No OPUS model assets are loaded or prefetched during deployment.\n4. Organic growth uses deterministic headline experiments, owned-site links, brand media and video-first local short-form manifests. Paid ads, paid generative video, and AI-written facts remain off; only bilingual translation uses the low-cost hosted model.\n5. Every item passes a deterministic three-role committee: source verifier, safety editor, and monetization editor. The committee itself calls no LLM. Only unanimous approval from an official/authorized source can become \`auto_eligible\`.\n6. Accusations are eligible only from a configured sensitive-capable official connector with complete provenance and neutral presumption-of-innocence language. Identifiable minors, victim private addresses, graphic violence, contradictory information, unconfirmed claims, and unverifiable critical evacuations receive an automatic final \`quarantined\` or \`rejected\` state.\n7. Each connected city/platform account targets at least 10 verified posts per day. The CEO can raise the target to 12 or 14 only from observed performance; relevance, never filler or duplication, unlocks volume. Breaking coverage may exceed the target.\n8. Overflow stays auto-eligible with \`gateReason=cadence\` and a future \`notBefore\`; corrections, updates and resolved/reopened notices create attributed revisions.\n9. Revenue progress toward $10,000 uses observed imported revenue only. Reach, engagement, revenue, cost, and profit are never inferred from queue state. Public incident sources do not guarantee complete road coverage; NY511 still needs its key and agreement.\n`;
}

function migrateLegacyCommitteeState(state: LocalNewsState, now: string): void {
  const events = new Map(state.events.map((event) => [event.id, event]));
  for (const item of state.queue) {
    if (Array.isArray(item.verdicts) && item.publishDecision && item.reviewHash && item.canonicalEventIdentity && item.claimIdentityHash) continue;
    const event = events.get(item.eventId);
    const committee = runLocalNewsReviewCommittee({
      source: item.source, sourceUrl: item.sourceUrl, title: event?.title || item.copy, description: event?.description || "",
      instruction: event?.instruction || "", location: event?.location || "", eventType: event?.eventType || item.section,
      risk: item.risk, section: item.section, editorialUrgency: item.editorialUrgency,
      connectorId: event?.provenance?.connectorId, canonicalHost: event?.provenance?.canonicalHost, fetchedAt: event?.provenance?.fetchedAt,
      claimHash: event?.provenance?.claimHash, provenanceVerified: event?.provenance?.verified, sensitiveEligibleConnector: event?.provenance?.sensitiveEligible, effective: event?.effective, expires: event?.expires,
    }, item.createdAt || now);
    const copyHash = hashLocalNewsReviewValue(item.copy);
    item.claimIdentityHash = hashLocalNewsReviewValue(event?.provenance?.claimHash || event?.fingerprint || [item.eventId, item.eventRevision, item.sourceUrl, item.copy]);
    item.canonicalEventIdentity = hashLocalNewsCanonicalEventIdentity({ eventId: item.eventId, eventRevision: item.eventRevision, lane: item.lane, title: event?.title || item.copy, description: event?.description || "", instruction: event?.instruction || "", location: event?.location || "", eventType: event?.eventType || item.section, source: event?.source || item.source, sourceUrl: event?.sourceUrl || item.sourceUrl, risk: item.risk, lifecycle: event?.lifecycle || item.lifecycle, effective: event?.effective || null, expires: event?.expires || null, claimIdentityHash: item.claimIdentityHash });
    item.verdicts = committee.verdicts;
    item.evidence = [...committee.evidence, `copyHash=${copyHash}`, "migrated_from_legacy_queue=true"];
    item.consensus = committee.consensus;
    item.publishDecision = committee.publishDecision;
    item.reasons = [...committee.reasons, "legacy_queue_review_backfilled"];
    item.checkedAt = committee.checkedAt;
    item.reviewHash = hashLocalNewsQueueReview({ queueItemId: item.id, eventId: item.eventId, eventRevision: item.eventRevision, lane: item.lane, copy: item.copy, platform: item.platform, risk: item.risk, canonicalEventIdentity: item.canonicalEventIdentity, claimIdentityHash: item.claimIdentityHash, verdicts: item.verdicts, evidence: item.evidence, consensus: item.consensus, publishDecision: item.publishDecision, checkedAt: item.checkedAt });
    if (committee.publishDecision !== "auto_publish") {
      item.status = committee.publishDecision === "reject" ? "rejected" : "quarantined";
      item.approvalRequired = false;
      item.autoEligible = false;
      item.gateReason = committee.publishDecision === "reject" ? "committee_reject" : "committee_quarantine";
    }
  }
}

export async function bootstrapClipperLocalNews(options: ClipperLocalNewsOptions = {}): Promise<ClipperLocalNewsStatus> {
  const dir = workspace(options);
  const now = isoNow(options.now);
  const env = options.env || process.env;
  await mkdir(dir, { recursive: true });
  let state = await readState(dir);
  if (!state) state = { version: 1, bootstrappedAt: now, updatedAt: now, lastRunAt: null, scheduleMinutes: scheduleMinutes(env), events: [], queue: [], metrics: [], editorialCounters: { duplicates: 0, revisions: 0, corrections: 0, resolvedRevisions: 0, cadenceHeld: 0 } };
  else {
    const compacted = await archiveAndCompactLocalNewsState(dir, state, now);
    state = compacted.state;
  }
  state.editorialCounters ||= { duplicates: 0, revisions: 0, corrections: 0, resolvedRevisions: 0, cadenceHeld: 0 };
  state.metrics ||= [];
  migrateLegacyCommitteeState(state, now);
  state.scheduleMinutes = scheduleMinutes(env);
  state.updatedAt = now;
  await Promise.all([
    atomicWrite(path.join(dir, FILES.runbook), runbook(state.scheduleMinutes)),
    atomicWrite(path.join(dir, FILES.sources), sourceSetup()),
  ]);
  await persist(dir, state);
  return getClipperLocalNewsStatus({ ...options, workspaceDir: dir });
}

function facebookCadenceLimit(event: ClipperLocalNewsEvent, existingQueue: ClipperLocalNewsQueueItem[], metrics: ClipperLocalNewsMetric[]): number {
  const relevanceLimit = event.editorialUrgency === "breaking" ? FACEBOOK_MAX_RELEVANT_PER_LANE : event.editorialUrgency === "developing" ? 8 : CADENCE.facebookPerLane;
  const relevantQueueIds = new Set(existingQueue.filter((item) => item.lane === event.lane && item.platform === "facebook" && item.section === event.section).map((item) => item.id));
  const observed = metrics.filter((metric) => metric.lane === event.lane && metric.platform === "facebook" && Boolean(metric.queueItemId && relevantQueueIds.has(metric.queueItemId)));
  const impressions = observed.reduce((total, metric) => total + metric.impressions, 0);
  const engagements = observed.reduce((total, metric) => total + metric.engagements, 0);
  const observedBoost = impressions >= 500 && engagements / impressions >= 0.03 ? 2 : 0;
  return Math.min(FACEBOOK_MAX_RELEVANT_PER_LANE, relevanceLimit + observedBoost);
}

async function queueFor(event: ClipperLocalNewsEvent, now: string, env: NodeJS.ProcessEnv, existingQueue: ClipperLocalNewsQueueItem[], metrics: ClipperLocalNewsMetric[], injectedTranslator?: LocalNewsTranslator): Promise<ClipperLocalNewsQueueItem[]> {
  const autoEnabled = !/^(0|false|no)$/i.test(env.CLIPPERS_LOCAL_NEWS_AUTO_ELIGIBLE || "true");
  const nowMs = new Date(now).getTime();
  const windowStart = nowMs - CADENCE.windowMinutes * 60_000;
  const translationRequired = localTranslationRequired(env, injectedTranslator);
  const bilingual = translationRequired ? await translateEventCopy(event, injectedTranslator || getDefaultLocalNewsTranslator()) : null;
  return Promise.all(PLATFORMS.map(async (platform) => {
    const recent = existingQueue.filter((item) => item.lane === event.lane && item.platform === platform && item.autoEligible && new Date(item.createdAt).getTime() >= windowStart);
    const totalLimit = platform === "facebook" ? facebookCadenceLimit(event, existingQueue, metrics) : CADENCE.xPerLane;
    const routineLimit = platform === "facebook" ? CADENCE.facebookRoutinePerLane : CADENCE.xRoutinePerLane;
    const cadenceHeld = event.editorialUrgency !== "breaking" && (recent.length >= totalLimit || (event.editorialUrgency === "routine" && recent.filter((item) => item.editorialUrgency === "routine").length >= routineLimit));
    const committee = runLocalNewsReviewCommittee({
      source: event.source, sourceUrl: event.sourceUrl, title: event.title, description: event.description, instruction: event.instruction,
      location: event.location, eventType: event.eventType, risk: event.risk, section: event.section, editorialUrgency: event.editorialUrgency,
      connectorId: event.provenance?.connectorId, canonicalHost: event.provenance?.canonicalHost, fetchedAt: event.provenance?.fetchedAt,
      claimHash: event.provenance?.claimHash, provenanceVerified: event.provenance?.verified, sensitiveEligibleConnector: event.provenance?.sensitiveEligible,
      effective: event.effective, expires: event.expires,
    }, now);
    const committeeGated = committee.publishDecision !== "auto_publish";
    const translationGated = translationRequired && !bilingual?.safe;
    const gateReason = committee.publishDecision === "reject" ? "committee_reject" as const : committeeGated || translationGated ? "committee_quarantine" as const : !autoEnabled ? "operator_opt_out" as const : cadenceHeld ? "cadence" as const : "none" as const;
    const gated = committeeGated || translationGated || !autoEnabled;
    const latestRecent = recent.reduce((latest, item) => Math.max(latest, new Date(item.notBefore || item.createdAt).getTime()), nowMs);
    const notBefore = cadenceHeld ? new Date(latestRecent + CADENCE.windowMinutes * 60_000).toISOString() : null;
    const relevantMetrics = metrics.filter((metric) => metric.lane === event.lane && metric.platform === platform);
    const organicGrowth = buildLocalNewsGrowthPackage({ ...event, mediaUrl: event.mediaUrl, mediaType: event.mediaType, qualityScore: event.qualityScore }, relevantMetrics, env.PUBLIC_BASE_URL, getLocalNewsGrowthScoutPattern(event.lane));
    const copy = buildClipperLocalNewsCopy(event, platform, organicGrowth, bilingual);
    const copyHash = hashLocalNewsReviewValue(copy);
    const publishDecision = (translationGated || !autoEnabled) && committee.publishDecision === "auto_publish" ? "quarantine" as const : committee.publishDecision;
    const status: ClipperLocalNewsQueueStatus = committee.publishDecision === "reject" ? "rejected" : committee.publishDecision === "quarantine" || translationGated ? "quarantined" : !autoEnabled ? "approval_required" : "auto_eligible";
    const translationEvidence = translationRequired ? bilingual?.safe ? ["local_translation=verified"] : [`local_translation_failed=${(bilingual?.issues || ["unknown"]).join(",")}`] : ["local_translation=disabled_nonproduction"];
    const mediaEvidence = event.mediaType === "video" && event.mediaUrl ? ["media=verified_official_video"] : event.mediaType === "image" && event.mediaUrl ? ["media=verified_official_image"] : ["media=none"];
    const evidence = [...committee.evidence, ...translationEvidence, ...mediaEvidence, `qualityScore=${event.qualityScore}`, `copyHash=${copyHash}`];
    const id = digest(`${event.id}|${event.revision}|${platform}`);
    const claimIdentityHash = hashLocalNewsReviewValue(event.provenance?.claimHash || event.fingerprint);
    const canonicalEventIdentity = hashLocalNewsCanonicalEventIdentity({ eventId: event.id, eventRevision: event.revision, lane: event.lane, title: event.title, description: event.description, instruction: event.instruction, location: event.location, eventType: event.eventType, source: event.source, sourceUrl: event.sourceUrl, risk: event.risk, lifecycle: event.lifecycle, effective: event.effective, expires: event.expires, claimIdentityHash });
    const originalPublishedAt = "originalPublishedAt" in event ? event.originalPublishedAt ?? null : event.effective;
    const reviewHash = hashLocalNewsQueueReview({ queueItemId: id, eventId: event.id, eventRevision: event.revision, lane: event.lane, copy, platform, risk: event.risk, canonicalEventIdentity, claimIdentityHash, verdicts: committee.verdicts, evidence, consensus: committee.consensus, publishDecision, checkedAt: committee.checkedAt, originalPublishedAt, expires: event.expires });
    const translationUnavailable = Boolean(translationGated && bilingual?.issues.some((issue) => issue.startsWith("local_translation_failed:")));
    const reasons = translationGated ? [...committee.reasons, translationUnavailable ? "local_translation_unavailable" : "local_translation_integrity_failed"] : !autoEnabled && committee.publishDecision === "auto_publish" ? [...committee.reasons, "operator_disabled_automatic_publication"] : committee.reasons;
    return { id, eventId: event.id, eventRevision: event.revision, canonicalEventIdentity, claimIdentityHash, lane: event.lane, platform, copy, source: event.source, sourceUrl: event.sourceUrl, risk: event.risk, lifecycle: event.lifecycle, effective: event.effective, originalPublishedAt, expires: event.expires, section: event.section, topicTag: event.topicTag, editorialUrgency: event.editorialUrgency, editorialPriority: event.editorialPriority, revisionKind: event.revisionKind, textOnly: !event.mediaUrl, mediaRequired: false, mediaUrl: event.mediaUrl, mediaType: event.mediaType, qualityScore: event.qualityScore, gateReason, notBefore, status, approvalRequired: status === "approval_required", autoEligible: !gated, published: false, createdAt: now, verdicts: committee.verdicts, evidence, consensus: committee.consensus, publishDecision, reasons, checkedAt: committee.checkedAt, reviewHash, organicGrowth };
  }));
}

export async function ingestClipperLocalNewsEvents(input: ClipperLocalNewsIngestInput): Promise<{ created: number; updated: number; duplicates: number; resolved: number; queued: number; status: ClipperLocalNewsStatus }> {
  ingestPayloadSchema.parse(input);
  const dir = workspace(input);
  await bootstrapClipperLocalNews({ ...input, workspaceDir: dir });
  const state = (await readState(dir))!;
  const now = isoNow(input.now);
  const env = input.env || process.env;
  state.editorialCounters ||= { duplicates: 0, revisions: 0, corrections: 0, resolvedRevisions: 0, cadenceHeld: 0 };
  const byId = new Map(state.events.map((event) => [event.id, event]));
  const seen = new Set<string>();
  let created = 0, updated = 0, duplicates = 0, resolved = 0, queued = 0;
  for (const raw of input.events) {
    const normalized = normalizeClipperLocalNewsEvent(raw, now);
    seen.add(normalized.id);
    const previous = byId.get(normalized.id);
    if (previous?.fingerprint === normalized.fingerprint) {
      const retryableTranslation = state.queue.some((item) => item.eventId === previous.id && item.eventRevision === previous.revision && item.reasons.includes("local_translation_unavailable"));
      if (retryableTranslation) {
        const refreshed = await queueFor(previous, now, env, state.queue, state.metrics, input.translator);
        for (const candidate of refreshed) {
          const index = state.queue.findIndex((item) => item.id === candidate.id);
          if (index >= 0) state.queue[index] = candidate;
        }
      }
      duplicates += 1; state.editorialCounters.duplicates += 1; continue;
    }
    const revisionKind: ClipperLocalNewsRevisionKind = normalized.revisionKind === "correction" ? "correction" : normalized.lifecycle === "resolved" ? "resolved" : previous ? "update" : "original";
    const originalPublishedAt = previous
      ? "originalPublishedAt" in previous ? previous.originalPublishedAt ?? null : previous.effective
      : typeof raw.properties?.sent === "string" ? raw.properties.sent : normalized.effective;
    const event: ClipperLocalNewsEvent = { ...normalized, originalPublishedAt, revisionKind, firstSeenAt: previous?.firstSeenAt || now, updatedAt: now, resolvedAt: normalized.lifecycle === "resolved" ? now : null, revision: (previous?.revision || 0) + 1 };
    byId.set(event.id, event);
    previous ? updated += 1 : created += 1;
    if (previous) state.editorialCounters.revisions += 1;
    if (event.revisionKind === "correction") state.editorialCounters.corrections += 1;
    if (event.revisionKind === "resolved") state.editorialCounters.resolvedRevisions += 1;
    if (event.lifecycle === "resolved") resolved += 1;
    const newItems = await queueFor(event, now, env, state.queue, state.metrics, input.translator);
    for (const item of newItems) if (!state.queue.some((existing) => existing.id === item.id)) { state.queue.push(item); queued += 1; if (item.gateReason === "cadence") state.editorialCounters.cadenceHeld += 1; }
  }
  if (input.resolveMissing) {
    const lanes = new Set(input.snapshotLanes?.length ? input.snapshotLanes : LANES);
    for (const [id, previous] of byId) {
      if (previous.lifecycle !== "active" || !lanes.has(previous.lane) || seen.has(id)) continue;
      const event = { ...previous, lifecycle: "resolved" as const, revisionKind: "resolved" as const, editorialUrgency: "routine" as const, resolvedAt: now, updatedAt: now, revision: previous.revision + 1 };
      event.fingerprint = digest(`${previous.fingerprint}|resolved`);
      byId.set(id, event);
      updated += 1; resolved += 1; state.editorialCounters.revisions += 1; state.editorialCounters.resolvedRevisions += 1;
      for (const item of await queueFor(event, now, env, state.queue, state.metrics, input.translator)) if (!state.queue.some((existing) => existing.id === item.id)) { state.queue.push(item); queued += 1; if (item.gateReason === "cadence") state.editorialCounters.cadenceHeld += 1; }
    }
  }
  const nowMs = new Date(now).getTime();
  for (const [id, previous] of byId) {
    if (previous.lifecycle !== "active" || !previous.expires) continue;
    const expiresAt = new Date(previous.expires).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt > nowMs) continue;
    const event = { ...previous, lifecycle: "resolved" as const, revisionKind: "resolved" as const, editorialUrgency: "routine" as const, resolvedAt: now, updatedAt: now, revision: previous.revision + 1 };
    event.fingerprint = digest(`${previous.fingerprint}|expired`);
    byId.set(id, event);
    updated += 1; resolved += 1; state.editorialCounters.revisions += 1; state.editorialCounters.resolvedRevisions += 1;
    for (const item of await queueFor(event, now, env, state.queue, state.metrics, input.translator)) if (!state.queue.some((existing) => existing.id === item.id)) { state.queue.push(item); queued += 1; if (item.gateReason === "cadence") state.editorialCounters.cadenceHeld += 1; }
  }
  state.events = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  state.updatedAt = now;
  await persist(dir, state);
  return { created, updated, duplicates, resolved, queued, status: await getClipperLocalNewsStatus({ ...input, workspaceDir: dir }) };
}

interface SourceDefinition { id: string; lane: ClipperLocalNewsLane; url: string; requiresKey: boolean; key?: string; format?: "json" | "rss" | "mta-json" | "miami-transit-bootstrap" | "bso-breaking-html"; sourceName?: string; sensitiveEligible?: boolean; allowedArticlePathPrefix?: string }
interface ConnectorDefinition { id: string; lane: ClipperLocalNewsLane; configured: boolean; requiresKey: boolean; public: boolean }

function connectorCatalog(env: NodeJS.ProcessEnv): ConnectorDefinition[] {
  const trafficEnabled = env.CLIPPERS_LOCAL_NEWS_INCLUDE_TRAFFIC === "true";
  return [
    { id: "nws-miami", lane: "miami-news", configured: true, requiresKey: false, public: true },
    { id: "nws-nyc", lane: "ny-news", configured: true, requiresKey: false, public: true },
    { id: "notify-nyc", lane: "ny-news", configured: trafficEnabled, requiresKey: false, public: true },
    { id: "fbi-ny", lane: "ny-news", configured: true, requiresKey: false, public: true },
    { id: "doj-sdny", lane: "ny-news", configured: true, requiresKey: false, public: true },
    { id: "fbi-miami", lane: "miami-news", configured: true, requiresKey: false, public: true },
    { id: "doj-sdfl", lane: "miami-news", configured: true, requiresKey: false, public: true },
    { id: "miami-dade-news", lane: "miami-news", configured: true, requiresKey: false, public: true },
    { id: "broward-sheriff-breaking", lane: "miami-news", configured: true, requiresKey: false, public: true },
    { id: "mia-airport-news", lane: "miami-news", configured: true, requiresKey: false, public: true },
    { id: "fhp-miami-dade", lane: "miami-news", configured: trafficEnabled, requiresKey: false, public: true },
    { id: "ny511", lane: "ny-news", configured: trafficEnabled && Boolean(env.NY511_FEED_URL && env.NY511_API_KEY), requiresKey: true, public: false },
    { id: "fl511", lane: "miami-news", configured: trafficEnabled && Boolean(env.FL511_FEED_URL), requiresKey: false, public: false },
    { id: "miami-generic", lane: "miami-news", configured: Boolean(env.MIAMI_NEWS_FEED_URL), requiresKey: false, public: false },
    { id: "ny-generic", lane: "ny-news", configured: Boolean(env.NY_NEWS_FEED_URL), requiresKey: false, public: false },
  ];
}

function sources(env: NodeJS.ProcessEnv): SourceDefinition[] {
  const result: SourceDefinition[] = [
    { id: "nws-miami", lane: "miami-news", url: "https://api.weather.gov/alerts/active?point=25.7617,-80.1918", requiresKey: false, sourceName: "National Weather Service" },
    { id: "nws-nyc", lane: "ny-news", url: "https://api.weather.gov/alerts/active?point=40.7128,-74.0060", requiresKey: false, sourceName: "National Weather Service" },
    { id: "fbi-ny", lane: "ny-news", url: "https://www.fbi.gov/feeds/new-york-news/rss.xml", requiresKey: false, format: "rss", sourceName: "Federal Bureau of Investigation New York", sensitiveEligible: true },
    { id: "doj-sdny", lane: "ny-news", url: "https://www.justice.gov/news/rss?field_component=1981&groupname=441&require_all=0&search_api_language=en&type=press_release", requiresKey: false, format: "rss", sourceName: "U.S. Attorney for the Southern District of New York", sensitiveEligible: true, allowedArticlePathPrefix: "/usao-sdny/" },
    { id: "fbi-miami", lane: "miami-news", url: "https://www.fbi.gov/feeds/miami-news/rss.xml", requiresKey: false, format: "rss", sourceName: "Federal Bureau of Investigation Miami", sensitiveEligible: true },
    { id: "doj-sdfl", lane: "miami-news", url: "https://www.justice.gov/news/rss?field_component=1771&require_all=0&search_api_language=en&show_public_archived=0&type=press_release", requiresKey: false, format: "rss", sourceName: "U.S. Attorney for the Southern District of Florida", sensitiveEligible: true, allowedArticlePathPrefix: "/usao-sdfl/" },
    { id: "miami-dade-news", lane: "miami-news", url: "https://www.miamidade.gov/global/rss-news.page", requiresKey: false, format: "rss", sourceName: "Miami-Dade County" },
    { id: "broward-sheriff-breaking", lane: "miami-news", url: "https://www.sheriff.org/pio/breaking-news/", requiresKey: false, format: "bso-breaking-html", sourceName: "Broward Sheriff's Office", sensitiveEligible: true },
    { id: "mia-airport-news", lane: "miami-news", url: "https://news.miami-airport.com/tagfeed/en-us/tags/airport%2Clatest__news", requiresKey: false, format: "rss", sourceName: "Miami International Airport" },
  ];
  if (env.CLIPPERS_LOCAL_NEWS_INCLUDE_TRAFFIC === "true") {
    result.push({ id: "notify-nyc", lane: "ny-news", url: "https://feeds.everbridge.net/feeds/453003085617722/rss/rss.xml", requiresKey: false, format: "rss", sourceName: "Notify NYC" });
    const arcGisBase = "https://services.arcgis.com/3wFbqsFPLeKqOlIK/ArcGIS/rest/services/Road_Closures/FeatureServer";
    ["closures", "crashes", "brush-fires", "other-incidents"].forEach((label, layer) => result.push({ id: `fhp-miami-${label}`, lane: "miami-news", url: `${arcGisBase}/${layer}/query?where=COUNTY%3D%27MIAMI-DADE%27&outFields=*&returnGeometry=false&f=json`, requiresKey: false, sourceName: "Florida Highway Patrol / FL511" }));
    if (env.NY511_FEED_URL && env.NY511_API_KEY) result.push({ id: "ny511", lane: "ny-news", url: env.NY511_FEED_URL, requiresKey: true, key: env.NY511_API_KEY });
    if (env.FL511_FEED_URL) result.push({ id: "fl511", lane: "miami-news", url: env.FL511_FEED_URL, requiresKey: false });
  }
  if (env.MIAMI_NEWS_FEED_URL) result.push({ id: "miami-generic", lane: "miami-news", url: env.MIAMI_NEWS_FEED_URL, requiresKey: false });
  if (env.NY_NEWS_FEED_URL) result.push({ id: "ny-generic", lane: "ny-news", url: env.NY_NEWS_FEED_URL, requiresKey: false });
  return result;
}

function defaultOfficialFeedTextFallback(source: { id: string; url: string }): Promise<string | null> {
  const allowedIds = new Set(["fbi-ny", "fbi-miami", "doj-sdny", "doj-sdfl", "broward-sheriff-breaking"]);
  if (!allowedIds.has(source.id)) return Promise.resolve(null);
  let url: URL;
  try { url = new URL(source.url); } catch { return Promise.resolve(null); }
  const allowed = (url.hostname === "www.fbi.gov" && /^\/feeds\/(?:new-york|miami)-news\/rss\.xml$/.test(url.pathname))
    || (url.hostname === "www.justice.gov" && url.pathname === "/news/rss")
    || (url.hostname === "www.sheriff.org" && url.pathname === "/pio/breaking-news/");
  if (!allowed || url.protocol !== "https:") return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    execFile("curl", [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--max-time", "20",
      "--max-filesize", "2500000",
      "--user-agent", "Mozilla/5.0 (compatible; RobertLocalNews/1.0; +https://robertwebsites.com)",
      url.toString(),
    ], { encoding: "utf8", maxBuffer: 2_600_000, timeout: 25_000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout || null);
    });
  });
}

function isHotNewsEvent(raw: ClipperLocalNewsRawEvent, now: string): boolean {
  const event = normalizeClipperLocalNewsEvent(raw, now);
  if (event.section === "traffic") return false;
  if (event.topicTag || event.section === "public_safety" || event.section === "breaking") return true;
  return event.risk === "critical" || (event.section === "weather" && event.risk === "high");
}

function extractEvents(payload: unknown): ClipperLocalNewsRawEvent[] {
  if (Array.isArray(payload)) return payload as ClipperLocalNewsRawEvent[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["features", "events", "incidents", "items", "results"]) if (Array.isArray(record[key])) return record[key] as ClipperLocalNewsRawEvent[];
  return [];
}

function rssTag(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function rssMedia(item: string): { url: string; type: "image" | "video" } | null {
  const enclosure = item.match(/<enclosure\b([^>]*)>/i)?.[1] || item.match(/<media:(?:content|thumbnail)\b([^>]*)>/i)?.[1] || "";
  const url = enclosure.match(/\burl\s*=\s*["']([^"']+)["']/i)?.[1] || "";
  if (!url) return null;
  const declaredType = enclosure.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] || "";
  const type = mediaTypeFor(`${declaredType} ${url}`);
  return type ? { url, type } : null;
}

function sourceArticleMatchesConnector(link: string, source: SourceDefinition): boolean {
  if (!source.allowedArticlePathPrefix) return true;
  try {
    const article = new URL(link);
    const feed = new URL(source.url);
    return article.hostname === feed.hostname && article.pathname.startsWith(source.allowedArticlePathPrefix);
  } catch {
    return false;
  }
}

function rssEvents(xml: string, source: SourceDefinition, now = isoNow()): ClipperLocalNewsRawEvent[] {
  const nowMs = new Date(now).getTime();
  const staleMs = source.sensitiveEligible ? SENSITIVE_OFFICIAL_RSS_STALE_MS : RSS_STALE_MS;
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, MAX_BATCH_SIZE).flatMap((match) => {
    const item = match[1];
    const title = rssTag(item, "title") || "Official local update";
    const description = rssTag(item, "description");
    const guid = rssTag(item, "guid");
    const link = rssTag(item, "link") || guid || source.url;
    if (!sourceArticleMatchesConnector(link, source)) return [];
    const sourceEventId = guid || link || digest(`${title}|${description}`);
    const media = rssMedia(item);
    const published = rssTag(item, "pubDate") || rssTag(item, "dc:date");
    const publishedDate = published ? new Date(published) : null;
    const publishedMs = publishedDate?.getTime();
    if (publishedMs && Number.isFinite(publishedMs) && (nowMs - publishedMs > staleMs || publishedMs - nowMs > RSS_FUTURE_SKEW_MS)) return [];
    return [attachVerifiedProvenance({ sourceEventId, source: source.sourceName || source.id, sourceUrl: safeUrl(link, source.url), lane: source.lane, title, description, eventType: rssTag(item, "category") || title, effective: publishedDate && Number.isFinite(publishedDate.getTime()) ? publishedDate.toISOString() : undefined, originalPublishedAt: publishedDate && Number.isFinite(publishedDate.getTime()) ? publishedDate.toISOString() : null, ...(media ? { mediaUrl: safeUrl(media.url, ""), mediaType: media.type } : {}) }, source, now)];
  });
}

function browardSheriffBreakingEvents(html: string, source: SourceDefinition, now = isoNow()): ClipperLocalNewsRawEvent[] {
  const serialized = html.match(/\blet\s+allNewsItems\s*=\s*(\[[\s\S]*?\]);/)?.[1];
  if (!serialized) return [];
  let items: unknown;
  try { items = JSON.parse(serialized); } catch { return []; }
  if (!Array.isArray(items)) return [];
  const nowMs = new Date(now).getTime();
  return items.slice(0, MAX_BATCH_SIZE).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const item = record.Item && typeof record.Item === "object" ? record.Item as Record<string, unknown> : {};
    const relativeUrl = clean(item.Url);
    const title = clean(item.Name);
    const dateMatch = clean(record.NewsPublishedDate).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!relativeUrl || !title || !dateMatch) return [];
    const effective = `${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}T12:00:00.000Z`;
    const effectiveMs = new Date(effective).getTime();
    if (!Number.isFinite(effectiveMs) || nowMs - effectiveMs > SENSITIVE_OFFICIAL_RSS_STALE_MS || effectiveMs - nowMs > RSS_FUTURE_SKEW_MS) return [];
    let sourceUrl: string;
    try {
      const article = new URL(relativeUrl, source.url);
      if (article.protocol !== "https:" || article.hostname !== "www.sheriff.org" || !article.pathname.startsWith("/pio/breaking-news/")) return [];
      sourceUrl = article.toString();
    } catch { return []; }
    return [attachVerifiedProvenance({
      sourceEventId: sourceUrl,
      source: source.sourceName || source.id,
      sourceUrl,
      lane: source.lane,
      title,
      description: title,
      location: "Broward County",
      eventType: "Official public safety release",
      effective,
      originalPublishedAt: effective,
    }, source, now)];
  });
}

function canonicalFetchedStoryKey(raw: ClipperLocalNewsRawEvent, now: string): string {
  const event = normalizeClipperLocalNewsEvent(raw, now);
  const numberWords: Record<string, string> = {
    one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
    eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20",
  };
  const titleKey = event.title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/g, (match) => numberWords[match] || match)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  let federalPressStory = false;
  try {
    const url = new URL(event.sourceUrl);
    federalPressStory = (url.hostname === "www.justice.gov" && url.pathname.startsWith("/usao-"))
      || (url.hostname === "www.fbi.gov" && url.pathname.includes("/field-offices/"));
  } catch {
    federalPressStory = false;
  }
  if (federalPressStory && titleKey) return `${event.lane}|federal-press|${titleKey}`;
  return `${event.lane}|${event.source.toLowerCase()}|${event.sourceEventId.toLowerCase()}|${event.location.toLowerCase()}`;
}

function fetchedStoryPreference(raw: ClipperLocalNewsRawEvent, now: string): number {
  const event = normalizeClipperLocalNewsEvent(raw, now);
  let score = event.editorialPriority + event.qualityScore;
  try {
    const url = new URL(event.sourceUrl);
    if (url.hostname === "www.justice.gov" && url.pathname.startsWith("/usao-")) score += 25;
    if (url.hostname === "www.fbi.gov" && url.pathname.includes("/field-offices/")) score += 15;
    if (!url.pathname.includes("/feeds/")) score += 10;
  } catch {
    score -= 10;
  }
  if (event.mediaType === "video") score += 20;
  else if (event.mediaType === "image") score += 8;
  return score;
}

function dedupeFetchedStoryEvents(events: ClipperLocalNewsRawEvent[], now = isoNow()): ClipperLocalNewsRawEvent[] {
  const byKey = new Map<string, { event: ClipperLocalNewsRawEvent; score: number; index: number }>();
  events.forEach((event, index) => {
    const key = canonicalFetchedStoryKey(event, now);
    const score = fetchedStoryPreference(event, now);
    const current = byKey.get(key);
    if (!current || score > current.score) byKey.set(key, { event, score, index });
  });
  return [...byKey.values()].sort((a, b) => a.index - b.index).map((entry) => entry.event);
}

function englishTranslation(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const translations = (value as { translation?: unknown }).translation;
  if (!Array.isArray(translations)) return "";
  const preferred = translations.find((item) => item && typeof item === "object" && (item as { language?: unknown }).language === "en")
    || translations.find((item) => item && typeof item === "object" && !String((item as { language?: unknown }).language || "").includes("html"));
  return preferred && typeof preferred === "object" ? clean((preferred as { text?: unknown }).text) : "";
}

function unixIso(value: unknown): string | undefined {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1_000).toISOString();
}

function mtaAlertEvents(payload: unknown, source: SourceDefinition, now = isoNow()): ClipperLocalNewsRawEvent[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { entity?: unknown }).entity)) return [];
  const nowMs = new Date(now).getTime();
  return ((payload as { entity: unknown[] }).entity).slice(0, MAX_BATCH_SIZE).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const entity = value as Record<string, unknown>;
    const id = clean(entity.id);
    if (!id.startsWith("lmm:alert:")) return [];
    const alert = entity.alert && typeof entity.alert === "object" ? entity.alert as Record<string, unknown> : null;
    if (!alert) return [];
    const periods = Array.isArray(alert.active_period) ? alert.active_period.filter((period): period is Record<string, unknown> => Boolean(period && typeof period === "object")) : [];
    const isActivePeriod = (period: Record<string, unknown>) => {
      const start = Number(period.start || 0) * 1_000;
      const end = Number(period.end || 0) * 1_000;
      return (!start || start <= nowMs + RSS_FUTURE_SKEW_MS) && (!end || end >= nowMs);
    };
    if (periods.length > 0 && !periods.some(isActivePeriod)) return [];
    const mercury = alert["transit_realtime.mercury_alert"] && typeof alert["transit_realtime.mercury_alert"] === "object"
      ? alert["transit_realtime.mercury_alert"] as Record<string, unknown>
      : {};
    const informed = Array.isArray(alert.informed_entity) ? alert.informed_entity.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
    const routes = [...new Set(informed.map((item) => clean(item.route_id)).filter(Boolean))];
    const title = englishTranslation(alert.header_text);
    if (!title) return [];
    const description = englishTranslation(alert.description_text);
    const primaryPeriod = periods.find(isActivePeriod) || periods[0];
    return [attachVerifiedProvenance({
      sourceEventId: id,
      source: source.sourceName || source.id,
      sourceUrl: "https://www.mta.info/alerts",
      lane: source.lane,
      title,
      description,
      instruction: description,
      location: routes.length ? `NYC Subway · Lines ${routes.join(", ")}` : "New York City Subway",
      eventType: clean(mercury.alert_type, "Subway service alert"),
      effective: unixIso(primaryPeriod?.start || mercury.created_at),
      expires: unixIso(primaryPeriod?.end),
      status: "active",
    }, source, now)];
  });
}

function miamiTransitEvents(payload: unknown, source: SourceDefinition, now = isoNow()): ClipperLocalNewsRawEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const nowMs = new Date(now).getTime();
  const items = ["universal", "metrorail", "metrobus", "metromover"]
    .flatMap((key) => Array.isArray(record[key]) ? record[key] as unknown[] : [])
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .filter((item) => {
      const expires = item.expireDate ? new Date(String(item.expireDate)).getTime() : 0;
      if (expires && Number.isFinite(expires) && expires < nowMs) return false;
      const effective = item.inEffect ? new Date(String(item.inEffect)).getTime() : 0;
      return Boolean(expires && expires >= nowMs) || !effective || !Number.isFinite(effective) || nowMs - effective <= MIAMI_TRANSIT_LOOKBACK_MS;
    })
    .slice(0, MIAMI_TRANSIT_MAX_ACTIVE);
  return items.flatMap((item) => {
    const id = clean(String(item.id ?? ""));
    const title = clean(item.title);
    if (!id || !title) return [];
    const html = typeof item.serviceUpdate === "string" ? item.serviceUpdate : "";
    const link = html.match(/href=["']([^"']+)["']/i)?.[1];
    const effective = item.inEffect ? new Date(String(item.inEffect)) : null;
    const expires = item.expireDate ? new Date(String(item.expireDate)) : null;
    const mode = clean(item.serviceUpdateType, "Transit");
    const route = clean(item.serviceUpdateTypeID);
    return [attachVerifiedProvenance({
      sourceEventId: `service-update-${id}`,
      source: source.sourceName || source.id,
      sourceUrl: safeUrl(link, source.url),
      lane: source.lane,
      title,
      description: decodeXml(html),
      instruction: "Check the official service update before traveling.",
      location: `Miami-Dade ${mode}${route ? ` · Route ${route}` : ""}`,
      eventType: `${mode} service update`,
      effective: effective && Number.isFinite(effective.getTime()) ? effective.toISOString() : undefined,
      expires: expires && Number.isFinite(expires.getTime()) ? expires.toISOString() : undefined,
      status: "active",
    }, source, now)];
  });
}

function arcGisEffective(attributes: Record<string, unknown>): string | undefined {
  const rawDate = clean(attributes.DATESTR);
  if (!rawDate) return undefined;
  const rawTime = clean(attributes.TIMESTR, "00:00");
  const parts = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const time = rawTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!parts || !time) return undefined;
  const candidate = new Date(`${parts[3]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}T${time[1].padStart(2, "0")}:${time[2]}:${time[3] || "00"}-04:00`);
  if (!Number.isFinite(candidate.getTime())) return undefined;
  return candidate.toISOString();
}

function sourceEvents(payload: unknown, source: SourceDefinition, now = isoNow()): ClipperLocalNewsRawEvent[] {
  return extractEvents(payload).flatMap((raw) => {
    const record = raw as Record<string, unknown>;
    const attributes = record.attributes && typeof record.attributes === "object" ? record.attributes as Record<string, unknown> : null;
    if (!attributes) return [attachVerifiedProvenance({ ...raw,
      ...(source.id.startsWith("nws-") ? { originalPublishedAt: raw.properties?.sent ?? null } : {}),
      lane: raw.lane || source.lane, source: raw.source || source.sourceName || source.id, sourceUrl: raw.sourceUrl || source.url }, source, now)];
    const value = (...keys: string[]) => keys.map((key) => attributes[key]).find((candidate) => candidate !== undefined && candidate !== null);
    const county = clean(value("COUNTY", "COUNTYNAME", "COUNTY_NAME")).toUpperCase();
    if (source.id.startsWith("fhp-miami-") && county && county !== "MIAMI-DADE" && county !== "MIAMI DADE") return [];
    const effective = arcGisEffective(attributes);
    if (effective && new Date(now).getTime() - new Date(effective).getTime() > ARCGIS_STALE_MS) return [];
    const kind = clean(value("TYPEEVENT", "INCIDENT_TYPE", "EVENT_TYPE", "TYPE", "CATEGORY"), source.id.includes("closures") ? "Road closure" : source.id.includes("crashes") ? "Traffic crash" : source.id.includes("brush-fires") ? "Brush fire" : "Road incident");
    const road = clean(value("ROADWAY", "ROAD_NAME", "STREET", "LOCATION", "ROUTE"), "Miami-Dade road");
    return [attachVerifiedProvenance({
      ...raw,
      properties: attributes,
      sourceEventId: clean(String(value("INCIDENTID", "INCIDENT_ID", "EVENT_ID", "OBJECTID", "FID") ?? "")) || undefined,
      source: source.sourceName || source.id,
      sourceUrl: source.url.split("/query?")[0],
      lane: source.lane,
      title: clean(value("TITLE", "HEADLINE"), `${kind} en ${road}`),
      description: clean(value("REMARKS", "DESCRIPTION", "DETAILS", "COMMENTS")),
      instruction: clean(value("INSTRUCTION", "ADVICE")),
      location: road,
      eventType: kind,
      status: clean(value("STATUS", "EVENT_STATUS")),
      effective,
    }, source, now)];
  });
}

export async function runClipperLocalNewsCycle(input: ClipperLocalNewsCycleInput = {}): Promise<{ fetchedSources: number; failedSources: Array<{ id: string; error: string }>; sourceObservations: SourceObservation[]; diagnosticWriteErrors: Array<{ sourceId: string; code: "write_failed" }>; created: number; updated: number; duplicates: number; resolved: number; queued: number; status: ClipperLocalNewsStatus }> {
  cyclePayloadSchema.parse(input);
  const dir = workspace(input);
  await bootstrapClipperLocalNews({ ...input, workspaceDir: dir });
  const now = isoNow(input.now);
  const env = input.env || process.env;
  let events = input.events;
  let fetchedSources = 0;
  const failedSources: Array<{ id: string; error: string }> = [];
  const sourceObservations: SourceObservation[] = [];
  const diagnosticWriteErrors: Array<{ sourceId: string; code: "write_failed" }> = [];
  const record = async (observation: SourceObservation, replace = false) => {
    try { await recordSourceObservation(dir, observation, replace); }
    catch { diagnosticWriteErrors.push({ sourceId: observation.sourceId, code: "write_failed" }); }
    const index = replace ? sourceObservations.findIndex(o => o.attemptId === observation.attemptId) : -1;
    if (index >= 0) sourceObservations[index] = observation;
    else sourceObservations.push(observation);
  };
  if (!events) {
    events = [];
    const fetcher = input.fetch || globalThis.fetch;
    const officialFeedTextFallback = input.officialFeedTextFallback || defaultOfficialFeedTextFallback;
    const hotOnly = env.CLIPPERS_LOCAL_NEWS_HOT_ONLY !== "false";
    for (const source of sources(env)) {
      let receivedCount: number | null = null;
      if (source.requiresKey && !source.key) {
        const observation = sourceObservation(source, isoNow(input.now), null, [], new Error("missing_api_key"));
        failedSources.push({ id: source.id, error: observation.error!.message });
        await record(observation);
        continue;
      }
      let observation: SourceObservation;
      try {
        const requestUrl = new URL(source.url);
        if (source.id === "ny511" && source.key) requestUrl.searchParams.set("key", source.key);
        let response: Response | null = null;
        let officialFeedText: string | null = null;
        try {
          response = await fetcher(requestUrl, { headers: { Accept: source.format === "rss" ? "application/rss+xml, application/xml, text/xml" : source.format === "miami-transit-bootstrap" || source.format === "bso-breaking-html" ? "text/html" : "application/geo+json, application/json", "User-Agent": "asistente-local-news/1.0" } });
        } catch (error) {
          if (source.format === "rss" || source.format === "bso-breaking-html") officialFeedText = await officialFeedTextFallback(source);
          if (!officialFeedText) throw error;
        }
        if (response && !response.ok) {
          if (source.format === "rss" || source.format === "bso-breaking-html") officialFeedText = await officialFeedTextFallback(source);
          if (!officialFeedText) throw new Error(`HTTP ${response.status}`);
        }
        let extracted: ClipperLocalNewsRawEvent[];
        let formatError: Error | undefined;
        if (source.format === "rss") {
          const xml = officialFeedText || await response!.text();
          const rssValid = /<rss\b/i.test(xml) && /<\/rss>/i.test(xml);
          receivedCount = [...xml.matchAll(/<item(?:\s[^>]*)?>/gi)].length;
          extracted = rssEvents(xml, source, now);
          if (!rssValid) formatError = new Error("invalid_response");
        }
        else if (source.format === "bso-breaking-html") {
          const html = officialFeedText || await response!.text();
          const serialized = html.match(/\blet\s+allNewsItems\s*=\s*(\[[\s\S]*?\]);/)?.[1];
          try {
            const payload = serialized ? JSON.parse(serialized) : null;
            if (!Array.isArray(payload)) formatError = new Error("invalid_response");
            else receivedCount = payload.length;
          } catch { formatError = new Error("invalid_response"); }
          extracted = browardSheriffBreakingEvents(html, source, now);
        }
        else if (source.format === "mta-json") extracted = mtaAlertEvents(await response!.json(), source, now);
        else if (source.format === "miami-transit-bootstrap") {
          const page = await response!.text();
          const apiKey = page.match(/<service-updates\b[^>]*\bapikey=["']([^"']+)["']/i)?.[1];
          if (!apiKey) throw new Error("public_transit_key_not_found");
          const transitResponse = await fetcher("https://www.miamidade.gov/apps/dtpw/transitapps/api/serviceupdates", {
            headers: { Accept: "application/json", "User-Agent": "asistente-local-news/1.0", "x-api-key": apiKey },
          });
          if (!transitResponse.ok) throw new Error(`HTTP ${transitResponse.status}`);
          extracted = miamiTransitEvents(await transitResponse.json(), source, now);
        } else {
          const payload = await response!.json();
          const collection = Array.isArray(payload) ? payload
            : ["features", "events", "incidents", "items", "results"].map(key => payload?.[key]).find(Array.isArray);
          receivedCount = Array.isArray(collection) ? collection.length : null;
          if (receivedCount === null) formatError = new Error("invalid_response");
          extracted = sourceEvents(payload, source, now);
        }
        if (hotOnly) extracted = extracted.filter((event) => isHotNewsEvent(event, now));
        const diagnosticItems = extracted.map(raw => ({
          ...raw,
          sourceEventId: raw.sourceEventId ?? raw.id ?? raw.properties?.id ?? raw.properties?.["@id"],
          effective: raw.effective || raw.properties?.effective || raw.properties?.sent,
        }));
        observation = sourceObservation(source, isoNow(input.now), receivedCount, diagnosticItems, formatError);
        events.push(...extracted); fetchedSources += 1;
      } catch (error) {
        observation = sourceObservation(source, isoNow(input.now), receivedCount, [], error);
        failedSources.push({ id: source.id, error: observation.error!.message });
      }
      // Telemetry failures are reported separately and never stop ingestion.
      await record(observation);
    }
    events = dedupeFetchedStoryEvents(events, now);
  }
  const controlledSnapshot = input.events !== undefined && input.resolveMissing === true;
  const priorRevisions = new Map(((await readState(dir))?.events ?? []).map(e => [e.id, e.revision]));
  // Dates are diagnostic metadata only: do not alter the existing event
  // fingerprints, queue dates, delivery policy or committee behavior.
  const contributionCandidates = new Map(events.map(raw => [
    normalizeClipperLocalNewsEvent(raw, now).id, raw.originalPublishedAt,
  ]));
  const result = await ingestClipperLocalNewsEvents({ ...input, workspaceDir: dir, now, events, resolveMissing: controlledSnapshot, snapshotLanes: controlledSnapshot ? input.snapshotLanes : undefined });
  const state = (await readState(dir))!;
  const contributions = new Map<string, number>();
  const acceptedRevisions = new Set(state.queue.filter(item => item.publishDecision === "auto_publish"
    && Array.isArray(item.verdicts) && item.verdicts.length === 3 && item.verdicts.every(v => v?.verdict === "approve"))
    .map(item => `${item.eventId}:${item.eventRevision}`));
  for (const event of state.events) {
    const originalDate = contributionCandidates.get(event.id);
    const date = typeof originalDate === "string" ? Date.parse(originalDate) : NaN;
    const accepted = acceptedRevisions.has(`${event.id}:${event.revision}`);
    if (priorRevisions.get(event.id) === event.revision || !event.provenance?.verified || !accepted
      || !Number.isFinite(date) || date > Date.parse(now) || Date.parse(now) - date > 72 * 3_600_000) continue;
    const id = event.provenance.connectorId;
    contributions.set(id, (contributions.get(id) ?? 0) + 1);
  }
  for (const observation of [...sourceObservations]) {
    try { await record(finalizeSourceObservation(observation, contributions.get(observation.sourceId) ?? 0), true); }
    catch { diagnosticWriteErrors.push({ sourceId: observation.sourceId, code: "write_failed" }); }
  }
  state.lastRunAt = now; state.updatedAt = now;
  await persist(dir, state);
  const status = await getClipperLocalNewsStatus({ ...input, workspaceDir: dir });
  if (diagnosticWriteErrors.length) {
    status.sourceDiagnostics.available = false;
    if (!status.sourceDiagnostics.storageError) status.sourceDiagnostics.storageError = "write_failed";
  }
  return { fetchedSources, failedSources, sourceObservations, diagnosticWriteErrors, created: result.created, updated: result.updated, duplicates: result.duplicates, resolved: result.resolved, queued: result.queued, status };
}

function nonNegativeInteger(value: unknown, field: string): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be a non-negative number`);
  return Math.round(number);
}

function nonNegativeMoney(value: unknown, field: string): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be a non-negative number`);
  return Math.round(number * 100) / 100;
}

export async function recordClipperLocalNewsMetrics(input: ClipperLocalNewsMetricsInput): Promise<{ recorded: number; status: ClipperLocalNewsStatus }> {
  metricPayloadSchema.parse(input);
  const dir = workspace(input);
  await bootstrapClipperLocalNews({ ...input, workspaceDir: dir });
  const state = (await readState(dir))!;
  const now = isoNow(input.now);
  for (const item of input.metrics) {
    if (!LANES.includes(item.lane) || !PLATFORMS.includes(item.platform)) throw new Error("Invalid metric lane or platform");
    const metric: ClipperLocalNewsMetric = { id: digest(JSON.stringify([item.queueItemId, item.eventId, item.lane, item.platform, item.observedAt || now, state.metrics.length])), queueItemId: item.queueItemId || null, eventId: item.eventId || null, lane: item.lane, platform: item.platform, impressions: nonNegativeInteger(item.impressions, "impressions"), reach: nonNegativeInteger(item.reach, "reach"), videoViews: nonNegativeInteger(item.videoViews, "videoViews"), engagements: nonNegativeInteger(item.engagements, "engagements"), clicks: nonNegativeInteger(item.clicks, "clicks"), shares: nonNegativeInteger(item.shares, "shares"), revenueUsd: nonNegativeMoney(item.revenueUsd, "revenueUsd"), costUsd: nonNegativeMoney(item.costUsd, "costUsd"), observedAt: isoNow(item.observedAt || now), recordedAt: now, variantId: item.variantId || null };
    state.metrics.push(metric);
  }
  state.updatedAt = now;
  await persist(dir, state);
  return { recorded: input.metrics.length, status: await getClipperLocalNewsStatus({ ...input, workspaceDir: dir }) };
}

export async function getClipperLocalNewsStatus(options: ClipperLocalNewsOptions = {}): Promise<ClipperLocalNewsStatus> {
  const dir = workspace(options);
  const state = await readState(dir);
  const env = options.env || process.env;
  const diagnosticCatalog: Array<{ id: string; name?: string; lane: ClipperLocalNewsLane; configured: boolean }> =
    sources(env).map(s => ({ id: s.id, name: s.sourceName ?? s.id, lane: s.lane, configured: true }));
  const activeIds = new Set(diagnosticCatalog.map(s => s.id));
  diagnosticCatalog.push(...connectorCatalog(env).filter(s => !s.configured && !activeIds.has(s.id)));
  const sourceDiagnostics = await readSourceDiagnostics(dir, diagnosticCatalog, isoNow(options.now), Math.max(30, scheduleMinutes(env) * 2));
  const artifacts = Object.fromEntries(Object.entries(FILES).map(([key, filename]) => [key, path.join(dir, filename)]));
  const emptyLane = () => ({ active: 0, resolved: 0, queued: 0 });
  const lanes: ClipperLocalNewsStatus["lanes"] = { "miami-news": emptyLane(), "ny-news": emptyLane() };
  if (state) {
    for (const event of state.events) lanes[event.lane][event.lifecycle] += 1;
    for (const item of state.queue) lanes[item.lane].queued += 1;
  }
  const metrics = summarizeMetrics(state?.metrics || []);
  const sections = Object.fromEntries(SECTIONS.map((section) => [section, { events: state?.events.filter((event) => event.section === section).length || 0, queued: state?.queue.filter((item) => item.section === section).length || 0 }])) as ClipperLocalNewsStatus["editorial"]["sections"];
  const urgency = Object.fromEntries(EDITORIAL_URGENCIES.map((level) => [level, state?.events.filter((event) => event.editorialUrgency === level).length || 0])) as ClipperLocalNewsStatus["editorial"]["urgency"];
  const counters = state?.editorialCounters || { duplicates: 0, revisions: 0, corrections: 0, resolvedRevisions: 0, cadenceHeld: 0 };
  const committeeItems = state?.queue.filter((item) => Array.isArray(item.verdicts) && item.verdicts.length === 3) || [];
  const revenueUsd = metrics.revenueUsd;
  return {
    sourceDiagnostics,
    workspaceDir: dir, bootstrapped: Boolean(state), scheduleMinutes: state?.scheduleMinutes ?? scheduleMinutes(env), lastRunAt: state?.lastRunAt || null, lanes,
    events: { total: state?.events.length || 0, active: state?.events.filter((event) => event.lifecycle === "active").length || 0, resolved: state?.events.filter((event) => event.lifecycle === "resolved").length || 0 },
    queue: { total: state?.queue.length || 0, approvalRequired: state?.queue.filter((item) => item.approvalRequired).length || 0, autoEligible: state?.queue.filter((item) => item.autoEligible).length || 0, quarantined: state?.queue.filter((item) => item.status === "quarantined" || item.publishDecision === "quarantine").length || 0, rejected: state?.queue.filter((item) => item.status === "rejected" || item.publishDecision === "reject").length || 0, published: 0 },
    editorial: {
      owner: "Local News CEO", operatingMode: "professional_newsroom", sections, urgency,
      autoSafe: state?.queue.filter((item) => item.autoEligible && item.risk !== "high" && item.risk !== "critical").length || 0,
      reviewRequired: state?.queue.filter((item) => item.approvalRequired).length || 0,
      cadenceHeld: state?.queue.filter((item) => item.gateReason === "cadence").length || counters.cadenceHeld,
      textOnlyFacebook: state?.queue.filter((item) => item.platform === "facebook" && item.textOnly === true && item.mediaRequired === false).length || 0,
      duplicates: counters.duplicates, revisions: counters.revisions, corrections: counters.corrections, resolvedRevisions: counters.resolvedRevisions,
      cadence: { ...CADENCE, facebookRelevantMax: FACEBOOK_MAX_RELEVANT_PER_LANE, adaptive: "urgency_and_observed_performance" },
      committee: {
        reviewed: committeeItems.length,
        unanimous: committeeItems.filter((item) => item.consensus === "unanimous_approve").length,
        quarantined: state?.queue.filter((item) => item.publishDecision === "quarantine" || item.gateReason === "committee_quarantine").length || 0,
        rejected: state?.queue.filter((item) => item.publishDecision === "reject" || item.gateReason === "committee_reject").length || 0,
        roles: ["source_verifier", "safety_editor", "monetization_editor"],
      },
      growth: {
        mode: "zero_cost_organic",
        paidAds: false,
        paidAiPerPost: true,
        ownedLinks: state?.queue.filter((item) => Boolean(item.organicGrowth?.ownedArticleUrl)).length || 0,
        experiments: state?.queue.filter((item) => Boolean(item.organicGrowth?.variantId)).length || 0,
        shortFormReady: state?.queue.filter((item) => item.organicGrowth?.shortForm.ready === true).length || 0,
        sourceVideos: state?.queue.filter((item) => item.mediaType === "video").length || 0,
        sourceImages: state?.queue.filter((item) => item.mediaType === "image").length || 0,
        highQuality: state?.queue.filter((item) => (item.qualityScore || 0) >= 70).length || 0,
        videoFirst: true,
        localTranslation: { mode: "hosted_openai_nano_batched", estimatedMonthlyApiCostUsd: 0.5, requiredInProduction: true },
      },
      dailyPublishing: dailyPublishingStatus(state),
    },
    metrics,
    monetization: {
      targetUsd: MONETIZATION_TARGET_USD,
      revenueUsd,
      remainingUsd: Math.max(0, Math.round((MONETIZATION_TARGET_USD - revenueUsd) * 100) / 100),
      progressPct: Math.min(100, Math.round((revenueUsd / MONETIZATION_TARGET_USD) * 10_000) / 100),
      externalEligibility: "unverified",
      pagesEligible: null,
      policyViolations: null,
      verifiedAt: null,
      bySection: summarizeMetricsBySection(state),
    },
    connectors: connectorCatalog(env),
    coverage: {
      weather: "nws_public",
      miamiTraffic: env.CLIPPERS_LOCAL_NEWS_INCLUDE_TRAFFIC === "true" ? env.FL511_FEED_URL || env.MIAMI_NEWS_FEED_URL ? "configured_feed" : "public_incident_feed" : "not_configured",
      nyTraffic: env.CLIPPERS_LOCAL_NEWS_INCLUDE_TRAFFIC === "true" ? env.NY511_FEED_URL && env.NY511_API_KEY ? "ny511_configured" : "notify_nyc_public" : "not_configured",
      roadCoverageComplete: false,
      note: env.CLIPPERS_LOCAL_NEWS_INCLUDE_TRAFFIC === "true"
        ? "Traffic feeds are explicitly enabled for a dedicated campaign; they do not guarantee complete road coverage."
        : "Traffic feeds are intentionally disabled. The newsroom prioritizes verified crime, public-safety, immigration, and critical-weather reporting.",
    },
    artifacts,
    guardrails: ["Queue state never proves or claims real publication.", "Every social post is bilingual (Spanish and English) in one publication; verified stories are never duplicated merely to hit a quota.", "Only official/public or authorized sources with unanimous committee approval can become auto-eligible; commercial news articles are never scraped.", "Violent crime, kidnapping, and immigration topics receive editorial priority boosts, but never bypass source verification or the safety committee.", "Routine traffic is excluded from automatic Metricool delivery by default; set CLIPPERS_LOCAL_NEWS_INCLUDE_TRAFFIC=true only for an explicit traffic campaign.", "Revenue progress, cost, reach, and engagement include only explicitly recorded observations; no money or performance is inferred.", "Unresolved accusations, identifiable minors, victim private addresses, graphic violence, contradictory information, unconfirmed claims, and unverifiable critical evacuations receive automatic final quarantine/reject decisions, not a human-review wait.", "Each connected city/platform account targets 10 verified posts daily and can rise to 12 or 14 only from observed performance; routine filler and engagement bait remain blocked.", "Cadence overflow remains automatic but cannot publish before its notBefore timestamp.", "Secrets are read from environment variables and never persisted."],
  };
}

export const __clipperLocalNewsInternals = { riskFor, sectionFor, topicTagFor, editorialUrgencyFor, editorialPriorityFor, sources, connectorCatalog, truncate, xWeightedLength, extractEvents, rssEvents, browardSheriffBreakingEvents, dedupeFetchedStoryEvents, sourceArticleMatchesConnector, sourceEvents, mtaAlertEvents, miamiTransitEvents, scheduleMinutes };
