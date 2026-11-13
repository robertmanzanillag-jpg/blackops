import { captureLearningSnapshots, isLearningObservation, learningSourceHealth, type LearningObservation, type LearningNetwork, type LearningSnapshot } from "./blackroom-learning-observations";
import { proposeManualExploration } from "./blackroom-manual-exploration";
import type { reconcileManualObservations } from "./blackroom-manual-observations";
import { BLACKROOM_LEARNING_NETWORKS, BLACKROOM_DURATION_TEST_ID, DURATION_ARMS, canonicalLearningPostId, durationDecisionId, evaluateBlackRoomLearning, evaluateDurationLearning, type VerifiedLearningDecision, type DurationDecision } from "./blackroom-verified-learning";
import type { BlackRoomCeoAnalytics, BlackRoomPublicationExperiment } from "./blackroom-growth-ceo";

type SourcePost = LearningObservation & { references: string[]; durationSeconds?: number; minDuration?: number; maxDuration?: number };
type Decisions = Record<LearningNetwork, VerifiedLearningDecision>;
export type EvidenceArchive = { version: 1; posts: SourcePost[]; snapshots: LearningSnapshot[] };
export const emptyEvidence = (): EvidenceArchive => ({ version: 1, posts: [], snapshots: [] });
const validReference = (ref: unknown): ref is string => typeof ref === "string" && /^BR-[a-f0-9]{12}$/.test(ref);

/** Observations are timed at acquisition, not at ingestion. Replaying a cached
 * export can recover a missed import, never freshen an old measurement. */
export function assessLocalBlackRoomExports(previous: EvidenceArchive, imports: unknown[], receipts: BlackRoomPublicationExperiment[], now: Date) {
  const byId = new Map<string, SourcePost>();
  const incoming: LearningObservation[] = [];
  const add = (post: SourcePost) => {
    const id = canonicalLearningPostId(post.network, post.postId);
    if (!id || !isLearningObservation(post) || Date.parse(post.observedAt) > now.getTime()) return;
    const k = post.network + ":" + id, old = byId.get(k);
    const latest = !old || Date.parse(post.observedAt) > Date.parse(old.observedAt) ? post : old;
    const durations = [old?.durationSeconds, old?.minDuration, old?.maxDuration, post.durationSeconds, post.minDuration, post.maxDuration]
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 86400);
    byId.set(k, { ...latest, postId: id, ...(durations.length ? {
      durationSeconds: latest.durationSeconds ?? durations[0], minDuration: Math.min(...durations), maxDuration: Math.max(...durations),
    } : {}), references: [...new Set([...(old?.references || []), ...post.references.filter(validReference)])] });
  };
  for (const post of previous.posts) add(post);
  for (const raw of imports) {
    const item = raw as { network?: LearningNetwork; samples?: Record<string, unknown>[] };
    if (!item?.network || !BLACKROOM_LEARNING_NETWORKS.includes(item.network) || !Array.isArray(item.samples)) continue;
    for (const sample of item.samples) {
      if (!sample || typeof sample.id !== "string") continue;
      const id = canonicalLearningPostId(item.network, sample.id);
      if (!id) continue;
      const obs: LearningObservation = {
        network: item.network, postId: id, publishedAt: String(sample.publishedAt || ""), observedAt: String(sample.observedAt || ""),
        views: sample.views as number,
        ...Object.fromEntries(["averageWatchSeconds", "completionRate", "likes", "comments", "shares"].flatMap(key =>
          sample[key] === undefined ? [] : [[key, sample[key]]])),
      };
      if (!isLearningObservation(obs) || Date.parse(obs.observedAt) > now.getTime()) continue;
      incoming.push(obs);
      const duration = sample.durationSeconds;
      add({ ...obs, ...(typeof duration === "number" && Number.isInteger(duration) && duration > 0 && duration <= 86400 ? { durationSeconds: duration } : {}),
        references: validReference(sample.learningReference) ? [sample.learningReference] : [] });
    }
  }
  // Bound recent evidence per network. No source files, signed media URLs,
  // authentication or remote controls are stored in the archive.
  const posts = BLACKROOM_LEARNING_NETWORKS.flatMap(net => [...byId.values()].filter(p => p.network === net)
    .sort((a,b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 10_000));
  const snapshots = captureLearningSnapshots(previous.snapshots, incoming, now)
    .filter(s => now.getTime() - Date.parse(s.publishedAt) <= 28 * 86400_000).slice(-30_000);
  const sourceObservedAt = Object.fromEntries(BLACKROOM_LEARNING_NETWORKS.map(net => [net, posts
    .filter(p => p.network === net).reduce<string | null>((v,p) => !v || Date.parse(p.observedAt) > Date.parse(v) ? p.observedAt : v, null)]));
  const experiments = receipts.map(e => ({ ...e, platformPostId: undefined as string | undefined }));
  const unique = new Map<string, SourcePost | null>();
  const receiptCounts = new Map<string, number>();
  for (const p of posts) for (const ref of p.references) {
    const key = p.network + ":" + ref;
    unique.set(key, (p.references.length !== 1 || unique.has(key)) ? null : p);
  }
  for (const e of experiments) {
    const key = e.network + ":" + e.learningReference;
    receiptCounts.set(key, (receiptCounts.get(key) || 0) + 1);
  }
  for (const e of experiments) {
    if (!validReference(e.learningReference)) continue;
    const key = e.network + ":" + e.learningReference;
    const post = unique.get(key);
    // Providers can round an encoded duration by one second. A material
    // contradiction in any observation vetoes the reference match, even if
    // the most recent export omitted duration. Never turn a 60s clip into
    // evidence for the controlled 15s test merely because its caption matches.
    if (post && receiptCounts.get(key) === 1 && [post.minDuration, post.maxDuration]
      .every(seconds => seconds === undefined || Math.abs(seconds - e.durationSeconds) <= 1)) e.platformPostId = post.postId;
  }
  const input = { snapshots, experiments, sourceObservedAt, now };
  const decisions = evaluateBlackRoomLearning(input);
  const durationDecisions = evaluateDurationLearning(input);
  // Descriptive, same-age ranges only. Do not call a duration a winner from
  // unmatched DJs, small samples, or lifetime views across different networks.
  const durations = new Map(posts.map(p => [p.network + ":" + p.postId, p.durationSeconds]));
  const groups = new Map<string, number[]>();
  for (const snap of snapshots) {
    const seconds = durations.get(snap.network + ":" + snap.postId);
    if (!seconds) continue;
    const band = seconds <= 15 ? "1-15s" : seconds <= 30 ? "16-30s" : seconds <= 60 ? "31-60s" : seconds <= 180 ? "61-180s" : "181s+";
    const key = [snap.network, snap.windowHours, band].join(":");
    const views = groups.get(key) || []; views.push(snap.views); groups.set(key, views);
  }
  const observedDurationCohorts = [...groups].map(([key, views]) => {
    views.sort((a,b) => a-b); const n = views.length;
    const [network, windowHours, durationBand] = key.split(":");
    return { network, windowHours: Number(windowHours), durationBand, posts: n, medianViews: (views[(n-1)>>1] + views[n>>1]) / 2 };
  });
  return {
    archive: { version: 1 as const, posts, snapshots },
    report: { version: 1 as const, scope: "local-evidence" as const, evaluatedAt: now.toISOString(), decisions,
      durationTestId: BLACKROOM_DURATION_TEST_ID, durationDecisions,
      networkSamples: Object.fromEntries(BLACKROOM_LEARNING_NETWORKS.map(net => [net, posts.filter(p => p.network === net).length])),
      snapshotCount: snapshots.length, observedDurationCohorts },
  };
}

/** An offline result may replace only an existing hook-test decision, never
 * change the operating mode, quotas, posting dates or the persisted queue. */
export function preferFreshLocalEvidence(remote: Decisions | undefined, local: Decisions | undefined, now: Date): Decisions | undefined {
  if (!remote || !local) return remote;
  const selected = { ...remote };
  for (const net of BLACKROOM_LEARNING_NETWORKS) {
    const candidate = local[net], current = remote[net];
    if (candidate?.network !== net || candidate.testId !== current?.testId || learningSourceHealth(candidate.sourceObservedAt, now).status !== "fresh") continue;
    if (!current.sourceObservedAt || Date.parse(candidate.sourceObservedAt!) > Date.parse(current.sourceObservedAt)) selected[net] = candidate;
  }
  return selected;
}

export function applyLocalEditorialReport(
  remote: BlackRoomCeoAnalytics, report: (Partial<ReturnType<typeof assessLocalBlackRoomExports>["report"]> & { manualObservations?: ReturnType<typeof reconcileManualObservations> }) | null, now: Date,
): BlackRoomCeoAnalytics {
  if (!remote?.verifiedLearning || report?.scope !== "local-evidence" || report.version !== 1) return remote;
  const verifiedLearning = preferFreshLocalEvidence(remote.verifiedLearning, report.decisions, now);
  let durationLearning = remote.durationLearning;
  if (report.durationTestId === BLACKROOM_DURATION_TEST_ID && report.durationDecisions) {
    let overlay: Record<LearningNetwork, DurationDecision> | undefined;
    for (const net of BLACKROOM_LEARNING_NETWORKS) {
      const d = report.durationDecisions[net], current = remote.durationLearning?.[net];
      if (!d || d.id !== durationDecisionId(net, d) || learningSourceHealth(d.sourceObservedAt, now).status !== "fresh") continue;
      if (current?.sourceObservedAt && Date.parse(current.sourceObservedAt) >= Date.parse(d.sourceObservedAt!)) continue;
      if (d.recommendedSeconds !== null && (!DURATION_ARMS.includes(d.recommendedSeconds) || d.matchedBlocks < 5 || !Array.isArray(d.evidencePostIds)
        || new Set(d.evidencePostIds).size < 15)) continue;
      overlay ||= remote.durationLearning ? { ...remote.durationLearning } : evaluateDurationLearning({ snapshots: [], experiments: [], sourceObservedAt: {}, now });
      overlay[net] = d;
    }
    durationLearning = overlay ?? durationLearning;
  }
  // Only the two editorial experiment fields can be overlaid; an old remote
  // hook-only deployment can now rotate durations when fresh local evidence
  // exists. Unknown destinations remain without a preference.
  return { ...remote, verifiedLearning, ...(durationLearning ? { durationLearning } : {}), manualExploration: proposeManualExploration(report.manualObservations, now) };
}
