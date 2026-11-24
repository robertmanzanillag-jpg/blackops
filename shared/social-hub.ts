// BlackOps Social Hub — in-house replacement for Metricool.
// Shared types used by server (publisher/scheduler/analytics) and client (panel).

export const SOCIAL_NETWORKS = [
  "facebook",
  "instagram",
  "threads",
  "tiktok",
  "youtube",
  "x",
  "linkedin",
  "reddit",
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export type SocialMediaKind = "none" | "image" | "video" | "carousel";

export interface NetworkCapabilities {
  text: boolean;
  image: boolean;
  video: boolean;
  carousel: boolean;
  maxCaptionChars: number;
  needsMedia: boolean;
  analytics: boolean;
  inbox: boolean;
}

export const NETWORK_CAPABILITIES: Record<SocialNetwork, NetworkCapabilities> = {
  facebook: { text: true, image: true, video: true, carousel: true, maxCaptionChars: 63206, needsMedia: false, analytics: true, inbox: true },
  instagram: { text: false, image: true, video: true, carousel: true, maxCaptionChars: 2200, needsMedia: true, analytics: true, inbox: true },
  threads: { text: true, image: true, video: true, carousel: true, maxCaptionChars: 500, needsMedia: false, analytics: true, inbox: true },
  tiktok: { text: false, image: true, video: true, carousel: true, maxCaptionChars: 2200, needsMedia: true, analytics: true, inbox: false },
  youtube: { text: false, image: false, video: true, carousel: false, maxCaptionChars: 5000, needsMedia: true, analytics: true, inbox: true },
  x: { text: true, image: true, video: true, carousel: true, maxCaptionChars: 280, needsMedia: false, analytics: true, inbox: true },
  linkedin: { text: true, image: true, video: true, carousel: false, maxCaptionChars: 3000, needsMedia: false, analytics: true, inbox: false },
  reddit: { text: true, image: true, video: true, carousel: false, maxCaptionChars: 40000, needsMedia: false, analytics: true, inbox: true },
};

/** Which business the post belongs to (the "empresa" side of BlackOps). */
export type SocialBrand = "blackroom" | "blackroom-femmes" | "blackroom-clothing" | "kong" | "ultimo-set" | string;

export type SocialPostStatus =
  | "draft"
  | "pending_approval"
  | "scheduled"
  | "publishing"
  | "published"
  | "partially_published"
  | "failed"
  | "cancelled";

export interface SocialPostTarget {
  network: SocialNetwork;
  accountId: string;
  /** Per-network caption override (e.g. shorter for X). */
  caption?: string;
  /** Reddit subreddit, YouTube title, etc. */
  options?: Record<string, string | boolean | number>;
}

export interface SocialPostInput {
  brand: SocialBrand;
  caption: string;
  mediaKind: SocialMediaKind;
  mediaUrls: string[];
  targets: SocialPostTarget[];
  /** ISO datetime. Omit or "best" to let the hub pick the best time. */
  publishAt?: string | "best";
  /** Who created it: "robert", "factory:<role>", "office:<agent>". */
  createdBy: string;
}

export interface SocialTargetResult {
  network: SocialNetwork;
  accountId: string;
  status: "pending" | "published" | "failed";
  externalId?: string;
  url?: string;
  error?: string;
  attempts: number;
}

export interface SocialPost extends SocialPostInput {
  id: string;
  status: SocialPostStatus;
  publishAt: string;
  createdAt: string;
  approvedBy?: string;
  results: SocialTargetResult[];
}

export interface SocialMetricSnapshot {
  network: SocialNetwork;
  accountId: string;
  externalId?: string;
  capturedAt: string;
  followers?: number;
  impressions?: number;
  reach?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
}

export function engagementOf(m: SocialMetricSnapshot): number {
  return (m.likes ?? 0) + (m.comments ?? 0) * 2 + (m.shares ?? 0) * 3 + (m.saves ?? 0) * 2;
}

/** Returns validation problems for a post (empty = ok). */
export function validateSocialPost(input: SocialPostInput): string[] {
  const problems: string[] = [];
  if (!input.targets.length) problems.push("Elige al menos una red.");
  for (const t of input.targets) {
    const cap = NETWORK_CAPABILITIES[t.network];
    if (!cap) { problems.push(`Red desconocida: ${t.network}`); continue; }
    const caption = t.caption ?? input.caption;
    if (caption.length > cap.maxCaptionChars) problems.push(`${t.network}: el texto pasa de ${cap.maxCaptionChars} caracteres.`);
    if (cap.needsMedia && input.mediaKind === "none") problems.push(`${t.network}: necesita imagen o video.`);
    if (input.mediaKind !== "none" && !cap[input.mediaKind]) problems.push(`${t.network}: no acepta ${input.mediaKind}.`);
    if (t.network === "reddit" && !t.options?.subreddit) problems.push("reddit: falta el subreddit.");
    if (t.network === "youtube" && !t.options?.title) problems.push("youtube: falta el título.");
  }
  if (input.mediaKind !== "none" && !input.mediaUrls.length) problems.push("Falta la URL del archivo.");
  return problems;
}
