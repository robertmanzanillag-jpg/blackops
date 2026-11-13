import test from "node:test";
import assert from "node:assert/strict";
import { captureLearningSnapshots, isLearningObservation, learningSourceHealth, type LearningObservation } from "../server/blackroom-learning-observations";

const publishedAt = "2026-09-01T00:00:00Z";
const now = new Date("2026-09-28T00:00:00Z");
const observation = (hours: number, overrides: Partial<LearningObservation> = {}): LearningObservation => ({
  network: "tiktok", postId: "123", publishedAt,
  observedAt: new Date(Date.parse(publishedAt) + hours * 3_600_000).toISOString(),
  views: 100, ...overrides,
});

test("captures actual 24h, 72h, 7d windows without inventing missing snapshots", () => {
  const result = captureLearningSnapshots([], [observation(24), observation(74), observation(168), observation(200)], now);
  assert.deepEqual(result.map((item) => item.windowHours), [24, 72, 168]);
  assert.equal(captureLearningSnapshots([], [observation(600)], now).length, 0);
  assert.equal(captureLearningSnapshots([], [observation(23.99), observation(30), observation(78), observation(174)], now).length, 0);
});

test("replay does not replace a historical measurement with a newer cumulative total", () => {
  const initial = captureLearningSnapshots([], [observation(26, { views: 200 })], now);
  const updated = captureLearningSnapshots(initial, [observation(25, { views: 150 }), observation(29, { views: 400 })], now);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].views, 150);
  assert.deepEqual(captureLearningSnapshots(updated, [observation(29)], now), updated);
  assert.equal(initial[0].views, 200);
});

test("same IDs on different networks remain independent", () => {
  const result = captureLearningSnapshots([], [observation(24), observation(24, { network: "youtube" })], now);
  assert.equal(result.length, 2);
});

test("rejects absent, invalid and future metrics instead of manufacturing zero", () => {
  for (const views of [null, undefined, "", "0", -1, NaN, Infinity]) {
    assert.equal(isLearningObservation(observation(24, { views: views as number })), false);
  }
  assert.equal(isLearningObservation(observation(24, { views: 0 })), true);
  assert.equal(isLearningObservation(observation(24, { publishedAt: "2026-09-01T00:00:00" })), false);
  assert.equal(captureLearningSnapshots([], [observation(24)], new Date(publishedAt)).length, 0);
  assert.equal(isLearningObservation(observation(24, { completionRate: 2 })), false);
});

test("freshness depends on source observation time, never planner refresh time", () => {
  assert.equal(learningSourceHealth("2026-07-31T00:00:00Z", now).status, "stale");
  assert.equal(learningSourceHealth(null, now).status, "missing");
  assert.equal(learningSourceHealth("2026-09-27T18:00:00Z", now).status, "fresh");
  assert.equal(learningSourceHealth("2026-09-29T00:00:00Z", now).status, "invalid");
});
