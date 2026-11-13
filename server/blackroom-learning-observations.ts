/** Pure observation ledger. No provider, model, filesystem or publication calls. */
export const LEARNING_WINDOWS_HOURS = [24, 72, 168] as const;
export type LearningWindowHours = typeof LEARNING_WINDOWS_HOURS[number];
export type LearningNetwork = "tiktok" | "facebook" | "youtube";

export interface LearningObservation {
  network: LearningNetwork;
  postId: string;
  publishedAt: string;
  /** Time metrics were acquired from the provider, NOT planner refresh time.
   * Provider reporting delays may apply; this is not a provider event watermark. */
  observedAt: string;
  views: number;
  averageWatchSeconds?: number;
  completionRate?: number;
  likes?: number;
  comments?: number;
  shares?: number;
}

export interface LearningSnapshot extends LearningObservation {
  windowHours: LearningWindowHours;
  ageHours: number;
}

const HOUR_MS = 3_600_000;
const NETWORKS = new Set(["tiktok", "facebook", "youtube"]);
const isoTimestamp = (value: string) =>
  typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : Number.NaN;

/** Null/empty metrics must never be silently converted into zero. */
export function isLearningObservation(value: LearningObservation): boolean {
  if (!value || !NETWORKS.has(value.network) || typeof value.postId !== "string" || !value.postId.trim()) return false;
  if (typeof value.views !== "number" || !Number.isSafeInteger(value.views) || value.views < 0) return false;
  const published = isoTimestamp(value.publishedAt);
  const observed = isoTimestamp(value.observedAt);
  if (!Number.isFinite(published) || !Number.isFinite(observed) || observed < published) return false;
  for (const name of ["averageWatchSeconds", "completionRate", "likes", "comments", "shares"] as const) {
    const metric = value[name];
    if (metric === undefined) continue;
    if (typeof metric !== "number" || !Number.isFinite(metric) || metric < 0) return false;
    if (name === "completionRate" && metric > 1) return false;
  }
  return true;
}

/** A six-hour acquisition window matches the collection cadence. Missing a
 * window leaves a gap; a later export cannot reconstruct historical totals.
 * Keep the earliest genuine measurement in each window, independent of replay
 * order. Network identity is part of the key to prevent cross-platform joins.
 */
export function captureLearningSnapshots(
  previous: readonly LearningSnapshot[],
  incoming: readonly LearningObservation[],
  now: Date,
): LearningSnapshot[] {
  const snapshots = new Map<string, LearningSnapshot>();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("Invalid observation clock");
  const add = (observation: LearningObservation, expectedWindow?: LearningWindowHours) => {
    if (!isLearningObservation(observation)) return;
    const observed = isoTimestamp(observation.observedAt);
    if (observed > nowMs) return;
    const ageHours = (observed - isoTimestamp(observation.publishedAt)) / HOUR_MS;
    const windowHours = LEARNING_WINDOWS_HOURS.find((hours) => ageHours >= hours && ageHours < hours + 6);
    if (!windowHours || (expectedWindow !== undefined && expectedWindow !== windowHours)) return;
    const key = JSON.stringify([observation.network, observation.postId.trim(), windowHours]);
    const existing = snapshots.get(key);
    if (existing && isoTimestamp(existing.observedAt) <= observed) return;
    snapshots.set(key, { ...observation, postId: observation.postId.trim(), windowHours, ageHours });
  };
  for (const snapshot of previous) {
    if (snapshot && LEARNING_WINDOWS_HOURS.includes(snapshot.windowHours)) add(snapshot, snapshot.windowHours);
  }
  for (const observation of incoming) add(observation);
  return [...snapshots.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt)
    || a.network.localeCompare(b.network) || a.postId.localeCompare(b.postId));
}

export function learningSourceHealth(
  lastObservedAt: string | null | undefined,
  now: Date,
): { status: "missing" | "fresh" | "stale" | "invalid"; ageHours: number | null } {
  if (!lastObservedAt) return { status: "missing", ageHours: null };
  const observed = isoTimestamp(lastObservedAt);
  const ageHours = (now.getTime() - observed) / HOUR_MS;
  if (!Number.isFinite(ageHours) || ageHours < 0) return { status: "invalid", ageHours: null };
  return { status: ageHours <= 12 ? "fresh" : "stale", ageHours };
}
