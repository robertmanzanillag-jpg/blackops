import test from "node:test";
import assert from "node:assert/strict";
import { BLACKROOM_HOOK_TEST_ID, canonicalLearningPostId, evaluateBlackRoomLearning } from "../server/blackroom-verified-learning";
import type { BlackRoomPublicationExperiment } from "../server/blackroom-growth-ceo";
import { captureLearningSnapshots, type LearningObservation } from "../server/blackroom-learning-observations";

const now = new Date("2026-09-28T00:00:00Z");
function fixture() {
  const experiments: BlackRoomPublicationExperiment[] = [];
  const observations: LearningObservation[] = [];
  for (let index = 0; index < 6; index++) for (const strategy of ["drop_first", "instant_drop"] as const) {
    const id = `${strategy}_${index}`;
    const publishedAt = `2026-09-${20 + index}T12:00:00Z`;
    experiments.push({ metricoolId: `scheduler_${id}`, platformPostId: id, learningTestId: BLACKROOM_HOOK_TEST_ID,
      reservationId: id, network: "youtube", creativeStrategy: strategy, durationSeconds: 15,
      format: "vertical", language: "en", slot: "08:00", publishedAt, dj: `DJ${index % 3}`, sourceVideoId: `set${index % 3}` });
    observations.push({ network: "youtube", postId: id, publishedAt,
      observedAt: new Date(Date.parse(publishedAt) + 24 * 3600_000).toISOString(),
      views: strategy === "instant_drop" ? 400 : 200, averageWatchSeconds: strategy === "instant_drop" ? 9 : 4 });
  }
  return { experiments, snapshots: captureLearningSnapshots([], observations, now),
    sourceObservedAt: { youtube: now.toISOString() }, now };
}
test("selects a provisional winner only from fresh exact matched same-age controlled observations", () => {
  const decisions = evaluateBlackRoomLearning(fixture());
  assert.equal(decisions.youtube.status, "testing");
  assert.equal(decisions.youtube.winner, "instant_drop");
  assert.equal(decisions.youtube.metric, "retention");
  assert.equal(decisions.youtube.windowHours, 24);
  assert.equal(decisions.youtube.matchedBlocks, 3);
  assert.equal(decisions.tiktok.winner, null);
  assert.equal(decisions.facebook.status, "missing");
});
test("stale sources and legacy scheduler IDs never manufacture winners", () => {
  const input = fixture();
  input.sourceObservedAt.youtube = "2026-07-31T00:00:00Z";
  assert.equal(evaluateBlackRoomLearning(input).youtube.status, "stale");
  input.sourceObservedAt.youtube = now.toISOString();
  input.experiments.forEach((experiment) => { delete experiment.platformPostId; });
  assert.equal(evaluateBlackRoomLearning(input).youtube.winner, null);
});
test("diagnostics distinguish missing tests, missing identities and missing age observations", () => {
  const input = fixture();
  input.experiments = [];
  let result = evaluateBlackRoomLearning(input).youtube;
  assert.match(result.reason, /Sin clips/);
  assert.equal(result.windowHours, null);
  input.experiments = fixture().experiments;
  input.experiments.forEach(e => { delete e.platformPostId; });
  result = evaluateBlackRoomLearning(input).youtube;
  assert.equal(result.declaredExperiments, 12);
  assert.equal(result.exactIdentities, 0);
  assert.match(result.reason, /Programado no significa publicado/);
  input.experiments = fixture().experiments;
  input.snapshots = [];
  result = evaluateBlackRoomLearning(input).youtube;
  assert.equal(result.exactIdentities, 12);
  assert.match(result.reason, /faltan mediciones/);
  assert.equal(result.winner, null);
});
test("different ages, treatments, confounders and ambiguous identities are excluded", () => {
  for (const variant of ["age", "language", "ambiguous", "test"] as const) {
    const input = fixture();
    if (variant === "age") input.snapshots.forEach((s, i) => { if (i % 2) s.windowHours = 72; });
    if (variant === "language") input.experiments.forEach((e) => { if (e.creativeStrategy === "instant_drop") e.language = "es"; });
    if (variant === "test") input.experiments.forEach((e) => { delete e.learningTestId; });
    if (variant === "ambiguous") input.experiments.push(...input.experiments.map((e) => ({ ...e, reservationId: `${e.reservationId}-other` })));
    assert.equal(evaluateBlackRoomLearning(input).youtube.winner, null, variant);
  }
});
test("requires both arms and several independent DJ blocks, not one viral clip", () => {
  const input = fixture();
  input.experiments.forEach((e) => { e.dj = "same DJ"; });
  assert.equal(evaluateBlackRoomLearning(input).youtube.winner, null);
  const oneArm = fixture();
  oneArm.experiments = oneArm.experiments.filter((e) => e.creativeStrategy === "instant_drop");
  assert.equal(evaluateBlackRoomLearning(oneArm).youtube.winner, null);
});
test("normalizes published URLs within the correct platform only", () => {
  assert.equal(canonicalLearningPostId("youtube", "https://www.youtube.com/shorts/abc"), "abc");
  assert.equal(canonicalLearningPostId("tiktok", "https://www.tiktok.com/@user/video/123"), "123");
  assert.equal(canonicalLearningPostId("facebook", "https://www.facebook.com/reel/456"), "456");
  assert.equal(canonicalLearningPostId("youtube", "https://evil.example/watch?v=abc"), null);
});

test("unmatched observations cannot pad the minimum evidence for a winner", () => {
  const input = fixture();
  input.experiments.forEach((e, i) => {
    if (i >= 6) e.dj = `unpaired-${i}`;
  });
  assert.equal(evaluateBlackRoomLearning(input).youtube.winner, null);
});

test("different source sets cannot be interpreted as a hook improvement", () => {
  const input = fixture();
  input.experiments.forEach((e) => { e.sourceVideoId = `${e.creativeStrategy}-${e.sourceVideoId}`; });
  assert.equal(evaluateBlackRoomLearning(input).youtube.winner, null);
});

test("rejects mislabeled age windows and invalid observations at the decision boundary", () => {
  for (const variant of ["window", "views", "date"] as const) {
    const input = fixture();
    input.snapshots.forEach((s) => {
      if (variant === "window") s.windowHours = 168;
      if (variant === "views") s.views = Number.NaN;
      if (variant === "date") s.observedAt = "invalid";
    });
    assert.equal(evaluateBlackRoomLearning(input).youtube.winner, null, variant);
  }
});
