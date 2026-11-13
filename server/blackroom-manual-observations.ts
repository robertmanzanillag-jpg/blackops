import { canonicalLearningPostId } from "./blackroom-verified-learning";
import { isLearningObservation, type LearningNetwork, type LearningObservation, type LearningSnapshot } from "./blackroom-learning-observations";

const networks = new Set(["facebook", "tiktok", "youtube"]);
export type ManualClip = { plannerId: string; network: LearningNetwork; dj: string; durationSeconds: number;
  sourceId: string; startSeconds: number; scheduledLocal: string; timezone: string };
export type PublishedReceipt = { plannerId: string; network: LearningNetwork; platformPostId: string;
  publicUrl: string; observedAt: string };
export type CalendarReceipts = { version: 1; brandId: "6585226"; source: "authenticated-metricool-scheduler";
  receipts: PublishedReceipt[]; checkedDays: Record<string, string>; attemptedDays?: Record<string,string>;
  failedDays?: Record<string,string>; lastError?: string };
export const emptyCalendarReceipts = (): CalendarReceipts => ({ version: 1, brandId: "6585226", source: "authenticated-metricool-scheduler", receipts: [], checkedDays: {} });

/** Manual caption markers, scheduled times and handwritten publicationEvidence
 * are not identity proof. Only the authenticated calendar receipt is joined. */
export function manualClipCandidates(documents: unknown[]): ManualClip[] {
  const rows: ManualClip[] = [];
  for (const raw of documents) {
    const doc = raw as any;
    if (String(doc?.brandId) !== "6585226" || !Array.isArray(doc.rows)) continue;
    for (const row of doc.rows.slice(-10_000)) {
      if (!/^\d+$/.test(String(row?.plannerId || "")) || !Array.isArray(row.networks)
        || typeof row.dj !== "string" || !row.dj.trim() || row.dj.length > 160
        || typeof row.sourceId !== "string" || !/^[\w-]{11}$/.test(row.sourceId)
        || !Number.isFinite(row.durationSeconds) || row.durationSeconds <= 0 || row.durationSeconds > 3600
        || !Number.isFinite(row.startSeconds) || row.startSeconds < 0
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(row.scheduledLocal || "")
        || row.timezone !== "America/New_York") continue;
      for (const network of new Set(row.networks)) if (networks.has(String(network))) rows.push({ plannerId: String(row.plannerId),
        network: network as LearningNetwork, dj: row.dj, durationSeconds: row.durationSeconds, sourceId: row.sourceId,
        startSeconds: row.startSeconds, scheduledLocal: row.scheduledLocal, timezone: row.timezone });
    }
  }
  return rows;
}

export function manualClips(documents: unknown[]): ManualClip[] {
  const rows = manualClipCandidates(documents);
  // Conflicting creative metadata is quarantined, not last-write-wins.
  const unique = new Map<string, ManualClip | null>();
  for (const row of rows) {
    const key = row.network + ":" + row.plannerId;
    if (!unique.has(key)) unique.set(key, row);
    else if (JSON.stringify(unique.get(key)) !== JSON.stringify(row)) unique.set(key, null);
  }
  return [...unique.values()].filter((r): r is ManualClip => r !== null);
}

export function publishedCalendarReceipts(body: unknown, allowed: ManualClip[], observedAt: string): PublishedReceipt[] {
  const data = body as any;
  const posts = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : null;
  if (!posts) throw new Error("Invalid Metricool calendar response");
  const keys = new Set(allowed.map(r => r.plannerId + ":" + r.network));
  const receipts: PublishedReceipt[] = [];
  for (const post of posts.slice(0, 5000)) {
    if (!Array.isArray(post?.providers)) continue;
    // Some responses omit blogId; the fixed authenticated request supplies scope.
    if (post.blogId != null && String(post.blogId) !== "6585226") continue;
    for (const provider of post.providers) {
      const network = provider?.network as LearningNetwork;
      if (!keys.has(String(post.id) + ":" + network) || provider.status !== "PUBLISHED"
        || typeof provider.publicUrl !== "string" || !provider.publicUrl.startsWith("https://")) continue;
      const id = canonicalLearningPostId(network, String(provider.id || ""));
      const urlId = canonicalLearningPostId(network, provider.publicUrl);
      if (!id || id !== urlId) continue;
      try { const url = new URL(provider.publicUrl); if (url.username || url.password || url.port) continue; } catch { continue; }
      receipts.push({ plannerId: String(post.id), network, platformPostId: id, publicUrl: provider.publicUrl, observedAt });
    }
  }
  return receipts;
}

export function reconcileManualObservations(clips: ManualClip[], calendar: CalendarReceipts,
  posts: LearningObservation[], snapshots: LearningSnapshot[], now: Date) {
  const rawReceipts = calendar?.version === 1 && calendar.brandId === "6585226"
    && calendar.source === "authenticated-metricool-scheduler" && Array.isArray(calendar.receipts) ? calendar.receipts : [];
  const receipts = rawReceipts.filter(r => networks.has(r?.network) && /^\d+$/.test(r.plannerId)
    && typeof r.publicUrl === "string" && r.publicUrl.startsWith("https://")
    && canonicalLearningPostId(r.network, r.publicUrl) === r.platformPostId
    && canonicalLearningPostId(r.network, r.platformPostId) === r.platformPostId
    && Number.isFinite(Date.parse(r.observedAt)) && Date.parse(r.observedAt) <= now.getTime());
  const result = clips.map(clip => {
    const candidates = receipts.filter(r => r.plannerId === clip.plannerId && r.network === clip.network
      && Number.isFinite(Date.parse(r.observedAt)) && Date.parse(r.observedAt) <= now.getTime());
    const ids = new Set(candidates.map(r => r.platformPostId));
    const base = { ...clip, mode: "observational" as const };
    if (!ids.size) return { ...base, status: "awaiting-publication" as const };
    const id = candidates[0].platformPostId;
    const reused = receipts.some(r => r.network === clip.network && r.platformPostId === id && r.plannerId !== clip.plannerId);
    if (ids.size !== 1 || reused) return { ...base, status: "identity-conflict" as const };
    const matching = posts.filter(p => p.network === clip.network && p.postId === id && isLearningObservation(p)
      && Date.parse(p.observedAt) <= now.getTime());
    const latest = matching.sort((a,b) => Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
    const receipt = candidates.sort((a,b) => Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
    if (!latest) return { ...base, platformPostId: id, publicUrl: receipt.publicUrl, status: "awaiting-metrics" as const };
    const measured = latest as LearningObservation & { durationSeconds?: number; minDuration?: number; maxDuration?: number };
    if ([measured.durationSeconds, measured.minDuration, measured.maxDuration].some(seconds => seconds !== undefined
      && (!Number.isFinite(seconds) || Math.abs(seconds - clip.durationSeconds) > 1))) {
      return { ...base, platformPostId:id, status:"metadata-conflict" as const };
    }
    return { ...base, platformPostId: id, publicUrl: receipt.publicUrl, status: "observed" as const,
      observation: latest, snapshots: snapshots.filter(s => s.network === clip.network && s.postId === id) };
  });
  return { evaluatedAt: now.toISOString(), mode: "observational-only" as const, deliveries: result,
    awaitingPublication: result.filter(r => r.status === "awaiting-publication").length,
    awaitingMetrics: result.filter(r => r.status === "awaiting-metrics").length,
    conflicts: result.filter(r => r.status === "identity-conflict" || r.status === "metadata-conflict").length,
    observed: result.filter(r => r.status === "observed").length,
    warning: "Descriptive observations only. No causal winner, historical reconstruction or controlled-test assignment." };
}
