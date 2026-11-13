import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const DAY_MS = 24 * 60 * 60_000;

export const LOCAL_NEWS_STATE_LIMITS = {
  queueRetentionMs: 8 * DAY_MS,
  eventRetentionMs: 8 * DAY_MS,
  metricRetentionMs: 90 * DAY_MS,
  maxQueueItems: 800,
  maxEvents: 600,
  maxMetrics: 5_000,
} as const;

type EventLike = { id?: string; updatedAt?: string; firstSeenAt?: string };
type QueueLike = { id?: string; eventId?: string; createdAt?: string };
type MetricLike = { id?: string; observedAt?: string; recordedAt?: string };

export interface CompactableLocalNewsState<E extends EventLike, Q extends QueueLike, M extends MetricLike> {
  events: E[];
  queue: Q[];
  metrics: M[];
}

export interface LocalNewsStatePartition<S, E, Q, M> {
  state: S;
  archived: { events: E[]; queue: Q[]; metrics: M[] };
}

function timestamp(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function boundedPartition<T>(items: T[], eligible: (item: T) => boolean, maximum: number, dateFor: (item: T) => number): { active: T[]; archived: T[] } {
  const candidates = items.filter(eligible);
  const selected = candidates.length <= maximum
    ? new Set(candidates)
    : new Set([...candidates].sort((a, b) => dateFor(b) - dateFor(a)).slice(0, maximum));
  return {
    active: items.filter((item) => selected.has(item)),
    archived: items.filter((item) => !selected.has(item)),
  };
}

export function partitionLocalNewsState<
  E extends EventLike,
  Q extends QueueLike,
  M extends MetricLike,
  S extends CompactableLocalNewsState<E, Q, M>,
>(state: S, now: string | Date = new Date()): LocalNewsStatePartition<S, E, Q, M> {
  const nowMs = new Date(now).getTime();
  const queueCutoff = nowMs - LOCAL_NEWS_STATE_LIMITS.queueRetentionMs;
  const eventCutoff = nowMs - LOCAL_NEWS_STATE_LIMITS.eventRetentionMs;
  const metricCutoff = nowMs - LOCAL_NEWS_STATE_LIMITS.metricRetentionMs;

  const availableEventIds = new Set(state.events.map((event) => event.id).filter((id): id is string => Boolean(id)));
  const queueCandidates = state.queue
    .filter((item) => timestamp(item.createdAt) >= queueCutoff && Boolean(item.eventId && availableEventIds.has(item.eventId)))
    .sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt));
  const selectedQueue = new Set<Q>();
  const referencedEventIds = new Set<string>();
  for (const item of queueCandidates) {
    if (selectedQueue.size >= LOCAL_NEWS_STATE_LIMITS.maxQueueItems) break;
    const eventId = item.eventId!;
    if (!referencedEventIds.has(eventId) && referencedEventIds.size >= LOCAL_NEWS_STATE_LIMITS.maxEvents) continue;
    selectedQueue.add(item);
    referencedEventIds.add(eventId);
  }
  const queue = {
    active: state.queue.filter((item) => selectedQueue.has(item)),
    archived: state.queue.filter((item) => !selectedQueue.has(item)),
  };

  const selectedEventIds = new Set(referencedEventIds);
  const recentUnreferencedEvents = state.events
    .filter((event) => !selectedEventIds.has(event.id || "") && timestamp(event.updatedAt || event.firstSeenAt) >= eventCutoff)
    .sort((a, b) => timestamp(b.updatedAt || b.firstSeenAt) - timestamp(a.updatedAt || a.firstSeenAt));
  for (const event of recentUnreferencedEvents) {
    if (selectedEventIds.size >= LOCAL_NEWS_STATE_LIMITS.maxEvents) break;
    if (event.id) selectedEventIds.add(event.id);
  }
  const events = {
    active: state.events.filter((event) => Boolean(event.id && selectedEventIds.has(event.id))),
    archived: state.events.filter((event) => !event.id || !selectedEventIds.has(event.id)),
  };
  const metrics = boundedPartition(state.metrics, (metric) => timestamp(metric.observedAt || metric.recordedAt) >= metricCutoff, LOCAL_NEWS_STATE_LIMITS.maxMetrics, (metric) => timestamp(metric.observedAt || metric.recordedAt));

  return {
    state: { ...state, events: events.active, queue: queue.active, metrics: metrics.active } as S,
    archived: { events: events.archived, queue: queue.archived, metrics: metrics.archived },
  };
}

function writeArchiveLines(filePath: string, archivedAt: string, partition: LocalNewsStatePartition<unknown, EventLike, QueueLike, MetricLike>["archived"]): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(filePath, { flags: "a", encoding: "utf8", mode: 0o600 });
    output.once("error", reject);
    output.once("finish", resolve);
    for (const [kind, records] of Object.entries(partition) as Array<["events" | "queue" | "metrics", Array<EventLike | QueueLike | MetricLike>]>) {
      for (const record of records) {
        output.write(`${JSON.stringify({ archivedAt, kind, id: record.id || null, data: record })}\n`);
      }
    }
    output.end();
  });
}

export async function archiveAndCompactLocalNewsState<
  E extends EventLike,
  Q extends QueueLike,
  M extends MetricLike,
  S extends CompactableLocalNewsState<E, Q, M>,
>(directory: string, state: S, now: string | Date = new Date()): Promise<{ state: S; archived: { events: number; queue: number; metrics: number }; archivePath: string | null }> {
  const partition = partitionLocalNewsState(state, now);
  const counts = {
    events: partition.archived.events.length,
    queue: partition.archived.queue.length,
    metrics: partition.archived.metrics.length,
  };
  const archivePath = path.join(directory, "state-history.jsonl");
  if (counts.events + counts.queue + counts.metrics > 0) {
    await mkdir(directory, { recursive: true });
    await writeArchiveLines(archivePath, new Date(now).toISOString(), partition.archived);
  }
  return { state: partition.state, archived: counts, archivePath: counts.events + counts.queue + counts.metrics > 0 ? archivePath : null };
}
