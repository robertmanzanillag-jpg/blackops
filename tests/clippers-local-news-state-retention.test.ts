import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { archiveAndCompactLocalNewsState, LOCAL_NEWS_STATE_LIMITS, partitionLocalNewsState } from "../server/clippers-local-news-state-retention";

const NOW = new Date("2026-08-24T12:00:00.000Z");

test("archives stale news history losslessly while preserving recent queue references", async () => {
  const recent = new Date(NOW.getTime() - 2 * 24 * 60 * 60_000).toISOString();
  const stale = new Date(NOW.getTime() - 30 * 24 * 60 * 60_000).toISOString();
  const state = {
    events: [{ id: "recent", updatedAt: recent }, { id: "referenced", updatedAt: stale }, { id: "stale", updatedAt: stale }],
    queue: [{ id: "q1", eventId: "recent", createdAt: recent }, { id: "q2", eventId: "referenced", createdAt: recent }, { id: "q3", eventId: "stale", createdAt: stale }],
    metrics: [{ id: "m1", observedAt: recent }, { id: "m2", observedAt: new Date(NOW.getTime() - 120 * 24 * 60 * 60_000).toISOString() }],
  };
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-news-retention-"));
  const result = await archiveAndCompactLocalNewsState(directory, state, NOW);
  assert.deepEqual(result.state.queue.map((item) => item.id), ["q1", "q2"]);
  assert.deepEqual(result.state.events.map((event) => event.id), ["recent", "referenced"]);
  assert.deepEqual(result.archived, { events: 1, queue: 1, metrics: 1 });
  const archive = (await readFile(result.archivePath!, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(archive.map((entry) => `${entry.kind}:${entry.id}`).sort(), ["events:stale", "metrics:m2", "queue:q3"]);
});

test("hard caps protect the 512 MiB runtime and archive every overflow record", () => {
  const createdAt = NOW.toISOString();
  const state = {
    events: Array.from({ length: 900 }, (_, index) => ({ id: `event-${index}`, updatedAt: createdAt })),
    queue: Array.from({ length: 1_200 }, (_, index) => ({ id: `queue-${index}`, eventId: `event-${index % 900}`, createdAt })),
    metrics: Array.from({ length: 5_500 }, (_, index) => ({ id: `metric-${index}`, observedAt: createdAt })),
  };
  const result = partitionLocalNewsState(state, NOW);
  assert.equal(result.state.queue.length, LOCAL_NEWS_STATE_LIMITS.maxQueueItems);
  assert.equal(result.state.events.length, LOCAL_NEWS_STATE_LIMITS.maxEvents);
  assert.equal(result.state.metrics.length, LOCAL_NEWS_STATE_LIMITS.maxMetrics);
  assert.equal(result.archived.queue.length, 400);
  assert.equal(result.archived.events.length, 300);
  assert.equal(result.archived.metrics.length, 500);
  const activeEventIds = new Set(result.state.events.map((event) => event.id));
  assert.equal(result.state.queue.filter((item) => !activeEventIds.has(item.eventId)).length, 0);
});

test("never leaves an active queue item pointing to an archived or missing event", () => {
  const createdAt = NOW.toISOString();
  const state = {
    events: Array.from({ length: 800 }, (_, index) => ({ id: `event-${index}`, updatedAt: createdAt })),
    queue: [
      ...Array.from({ length: 800 }, (_, index) => ({ id: `queue-${index}`, eventId: `event-${index}`, createdAt })),
      { id: "missing", eventId: "event-missing", createdAt },
    ],
    metrics: [],
  };
  const result = partitionLocalNewsState(state, NOW);
  const activeEventIds = new Set(result.state.events.map((event) => event.id));
  assert.equal(result.state.events.length, LOCAL_NEWS_STATE_LIMITS.maxEvents);
  assert.equal(result.state.queue.length, LOCAL_NEWS_STATE_LIMITS.maxEvents);
  assert.equal(result.state.queue.filter((item) => !activeEventIds.has(item.eventId)).length, 0);
  assert.ok(result.archived.queue.some((item) => item.id === "missing"));
});
