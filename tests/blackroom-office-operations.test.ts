import test from "node:test";
import assert from "node:assert/strict";
import { buildBlackRoomOfficeOperations, readBlackRoomOfficeOperations } from "../server/blackroom-office-operations";
import type { BlackRoomRemoteControlState } from "../server/blackroom-remote-control";

const now = new Date("2026-11-05T17:00:00Z");
function fixture(): BlackRoomRemoteControlState {
  return { version: 1, desiredEnabled: true, weeks: 2, generation: 7, updatedAt: now.toISOString(), commands: [], chatHistory: [], analyticsImports: {}, learningSnapshots: [], publicationExperiments: [],
    device: { deviceId: "blackroom-primary", seenAt: now.toISOString(), appliedGeneration: 7, lastError: null,
      queue: { postsPerDay: 5, totals: { queued: 1, processing: 0, retry: 0, scheduled: 60, completed: 250 } }, worker: {} } };
}

test("connected queue is waiting, not productive work or confirmed calendar coverage", () => {
  const result = buildBlackRoomOfficeOperations(fixture(), now);
  assert.equal(result.state, "waiting");
  assert.equal(result.coverage.status, "unverified");
  assert.equal(result.policy.minimumDailyClips, 3);
  assert.equal(result.policy.maximumDailyClips, 5);
  assert.equal(result.execution.newPublisherStarted, false);
  assert.equal(result.execution.cloud24x7Verified, false);
  assert.equal(result.actions.every(a => a.executed === false), true);
});

test("offline and future heartbeats cannot imply work even with stale running flags", () => {
  for (const seenAt of ["2026-09-30T00:00:00Z", "2026-11-05T17:00:01Z", "invalid"]) {
    const state = fixture();
    state.device!.seenAt = seenAt;
    state.device!.worker = { running: true, pid: 123 };
    const result = buildBlackRoomOfficeOperations(state, now);
    assert.equal(result.state, "blocked");
    assert.equal(result.worker.processing, false);
    assert.equal(result.queue.authoritative, false);
    assert.ok(result.actions.some(a => a.id === "restore-worker"));
  }
});

test("fresh advancing activity is identified for scoring deduplication, not inferred from PID", () => {
  const state = fixture();
  state.device!.worker = { running: true, pid: 123 };
  assert.equal(buildBlackRoomOfficeOperations(state, now).state, "waiting");
  state.device!.worker.activity = [{ id: "render:42", createdAt: now.toISOString(), level: "success", stage: "edición" }];
  const result = buildBlackRoomOfficeOperations(state, now);
  assert.equal(result.state, "working");
  assert.equal(result.worker.progressEventId, "render:42");
  assert.equal(buildBlackRoomOfficeOperations(state, new Date(now.getTime() + 91_000)).worker.processing, false);
});

test("start-only info events and unrelated successes never imply productive progress", () => {
  for (const event of [{ level: "info", stage: "edición" }, { level: "success", stage: "heartbeat" }]) {
    const state = fixture();
    state.device!.worker = { running: true, activity: [{ id: "start", createdAt: now.toISOString(), ...event }] };
    assert.equal(buildBlackRoomOfficeOperations(state, now).state, "waiting");
  }
});

test("a newer or tied error overrides earlier success", () => {
  for (const errorAt of [now.toISOString(), "2026-11-05T16:59:59Z"]) {
    const state = fixture();
    state.device!.worker = { running: true, activity: [
      { id: "success", createdAt: "2026-11-05T16:59:59Z", level: "success", stage: "edición" },
      { id: "failure", createdAt: errorAt, level: "error", stage: "error" },
    ] };
    const result = buildBlackRoomOfficeOperations(state, now);
    assert.equal(result.state, "blocked");
    assert.equal(result.worker.processing, false);
    assert.equal(result.worker.progressEventId, null);
  }
});

test("unresolved device error, worker error or retry overrides a recent successful stage", () => {
  for (const failure of ["device", "worker", "retry"]) {
    const state = fixture();
    state.device!.worker = { running: true, activity: [{ id: "edited", createdAt: now.toISOString(), level: "success", stage: "edición" }] };
    if (failure === "device") state.device!.lastError = "pending failure";
    if (failure === "worker") state.device!.worker.lastError = "pending failure";
    if (failure === "retry") state.device!.queue.totals = { retry: 1 };
    const result = buildBlackRoomOfficeOperations(state, now);
    assert.equal(result.state, "blocked");
    assert.equal(result.worker.processing, false);
    assert.ok(result.actions.some(a => a.id === "inspect-worker-error"));
  }
});

test("pause and unapplied generations remain authoritative", () => {
  const state = fixture();
  state.desiredEnabled = false;
  assert.equal(buildBlackRoomOfficeOperations(state, now).state, "paused");
  assert.equal(buildBlackRoomOfficeOperations(state, now).actions.some(a => a.id === "restore-worker"), false);
  state.desiredEnabled = true;
  state.device!.appliedGeneration = 6;
  assert.equal(buildBlackRoomOfficeOperations(state, now).state, "blocked");
  state.device!.appliedGeneration = 8;
  assert.equal(buildBlackRoomOfficeOperations(state, now).state, "blocked");
});

test("fresh import timestamps cannot launder old or absent provider observations", () => {
  const state = fixture();
  state.analyticsImports.youtube = { importedAt: now.toISOString(), sourceFiles: [], samples: [{ id: "video1234567", views: 10, observedAt: "2026-09-30T00:00:00Z" }] };
  let result = buildBlackRoomOfficeOperations(state, now);
  assert.equal(result.learning.youtube.sourceStatus, "stale");
  assert.equal(result.learning.youtube.provisionalWinner, null);
  delete state.analyticsImports.youtube.samples[0].observedAt;
  result = buildBlackRoomOfficeOperations(state, now);
  assert.equal(result.learning.youtube.sourceStatus, "missing");
  assert.ok(result.actions.some(a => a.id === "restore-metrics"));
});

test("exact platform IDs are scoped to each network and conflicts never attribute", () => {
  const state = fixture();
  state.analyticsImports.youtube = { importedAt: now.toISOString(), sourceFiles: [], samples: [{ id: "video1234567", views: 10, observedAt: now.toISOString() }] };
  const experiment = { metricoolId: "planner-1", platformPostId: "video1234567", reservationId: "clip-1", network: "youtube", creativeStrategy: "drop_first" as const, durationSeconds: 15, format: "vertical" as const, language: "en" as const, slot: "12:00", publishedAt: now.toISOString() };
  state.publicationExperiments = [experiment];
  let result = buildBlackRoomOfficeOperations(state, now);
  assert.equal(result.learning.youtube.exactAttributed, 1);
  assert.equal(result.learning.facebook.exactAttributed, 0);
  assert.equal(result.learning.youtube.status, "collecting");
  assert.equal(result.learning.youtube.provisionalWinner, null);
  state.publicationExperiments.push({ ...experiment, reservationId: "clip-2" });
  result = buildBlackRoomOfficeOperations(state, now);
  assert.equal(result.learning.youtube.exactAttributed, 0);
  assert.ok(result.actions.some(a => a.id === "reconcile-identities"));
  state.publicationExperiments = [experiment, { ...experiment, durationSeconds: 30 }];
  assert.equal(buildBlackRoomOfficeOperations(state, now).learning.youtube.exactAttributed, 0);
});

test("invalid counters and volume are not silently trusted", () => {
  const state = fixture();
  state.device!.queue = { postsPerDay: 10, totals: { queued: "90", scheduled: -1, completed: Infinity } };
  const result = buildBlackRoomOfficeOperations(state, now);
  assert.equal(result.queue.queued, 0);
  assert.equal(result.queue.scheduled, 0);
  assert.ok(result.actions.some(a => a.id === "review-cadence"));
});

test("IO adapter performs exactly one persisted read without writes or mutation", async () => {
  const state = fixture(), before = JSON.stringify(state);
  let reads = 0;
  const result = await readBlackRoomOfficeOperations({ readRemote: async () => { reads++; return state; }, now });
  assert.equal(reads, 1);
  assert.equal(JSON.stringify(state), before);
  assert.equal(result.checkedAt, now.toISOString());
});
