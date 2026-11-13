import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRotatingSlots,
  claimNextBlackRoomJob,
  completeBlackRoomJob,
  cancelStaleBlackRoomJobs,
  createBlackRoomQueueState,
  recordBlackRoomFailedSource,
  ensureBlackRoomScheduleBuffer,
  pauseBlackRoomAgent,
  recoverInterruptedBlackRoomJobs,
  recordBlackRoomSourceUsage,
  retryBlackRoomJob,
  startBlackRoomAgent,
  summarizeBlackRoomQueue,
  readBlackRoomQueue,
  reconcileBlackRoomSchedule,
  writeBlackRoomQueue,
  withBlackRoomQueueLock,
  applyBlackRoomRemoteCommands,
} from "../server/blackroom-daily-queue";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("rotates the five-post learning baseline across the full day", () => {
  const overnight = buildRotatingSlots({ dayIndex: 0 });
  const late = buildRotatingSlots({ dayIndex: 1 });
  assert.equal(overnight.length, 5);
  assert.equal(late.length, 5);
  assert.notDeepEqual(overnight, late);
  for (const slots of [overnight, late]) assert.equal(new Set(slots.map((slot) => slot.localTime)).size, 5);
});

test("records non-overlapping source moments and tracks short and long-form experiments", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  recordBlackRoomSourceUsage(state, { videoId: "yt-001", jobId: "job-1", dj: "DJ A", format: "vertical", language: "en", durationSeconds: 15, segmentStartSeconds: 10, segmentEndSeconds: 25 }, now);
  recordBlackRoomSourceUsage(state, { videoId: "yt-002", jobId: "job-1", dj: "DJ A", format: "horizontal", language: "es", durationSeconds: 30, segmentStartSeconds: 50, segmentEndSeconds: 80 }, now);
  recordBlackRoomSourceUsage(state, { videoId: "yt-003", jobId: "job-1", dj: "DJ B", format: "vertical", language: "en", durationSeconds: 60, segmentStartSeconds: 100, segmentEndSeconds: 160 }, now);
  recordBlackRoomSourceUsage(state, { videoId: "yt-004", jobId: "job-1", dj: "DJ B", format: "horizontal", language: "es", durationSeconds: 120, segmentStartSeconds: 200, segmentEndSeconds: 320 }, now);
  recordBlackRoomSourceUsage(state, { videoId: "yt-005", jobId: "job-1", dj: "DJ C", format: "vertical", language: "en", durationSeconds: 300, segmentStartSeconds: 300, segmentEndSeconds: 600 }, now);
  recordBlackRoomSourceUsage(state, { videoId: "yt-006", jobId: "job-1", dj: "DJ C", format: "horizontal", language: "es", durationSeconds: 600, segmentStartSeconds: 600, segmentEndSeconds: 1200 }, now);
  assert.deepEqual(state.sourceHistory.map((item) => item.durationSeconds), [15, 30, 60, 120, 300, 600]);
  assert.throws(() => recordBlackRoomSourceUsage(state, { videoId: "yt-001", jobId: "job-2", dj: "DJ C", format: "vertical", language: "es", durationSeconds: 15, segmentStartSeconds: 0, segmentEndSeconds: 15 }, now), /overlaps/);
  assert.doesNotThrow(() => recordBlackRoomSourceUsage(state, { videoId: "yt-001", jobId: "job-2", dj: "DJ A", format: "horizontal", language: "es", durationSeconds: 15, segmentStartSeconds: 30, segmentEndSeconds: 45 }, now));
});

test("keeps a two-week persistent scheduling buffer", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  assert.equal(ensureBlackRoomScheduleBuffer(state, now), 14);
  assert.equal(ensureBlackRoomScheduleBuffer(state, now), 0);
  assert.equal(state.jobs.length, 14);
  assert.equal(state.jobs[0].requirements.posts, 5);
  assert.equal(state.jobs.filter((job) => new Date(job.notBefore) <= now).length, 3);
  assert.ok(new Date(state.jobs[13].notBefore) > now);
  assert.equal(state.jobs[0].requirements.djs, 5);
  assert.equal(state.jobs[0].requirements.deleteOnlyAfterMetricoolConfirmation, true);
  assert.deepEqual(state.jobs[0].requirements.durationsSeconds, [15, 30, 60, 120, 300, 600]);
});

test("summarizes the exact pending post count and campaign finish estimate", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  state.jobs[0].status = "completed";
  state.jobs[1].status = "scheduled";
  state.jobs[2].status = "retry";
  state.jobs[2].requirements.posts = 7;
  const summary = summarizeBlackRoomQueue(state, now);
  assert.equal(summary.progress.remainingBatches, 12);
  assert.equal(summary.progress.remainingPosts, 62);
  assert.equal(summary.progress.remainingDays, 12);
  assert.equal(summary.progress.remainingCalendarDays, 15);
  assert.equal(summary.progress.estimatedFinishDate, "2026-08-03");
});

test("reports a completed queue without inventing remaining time", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  state.jobs.forEach((job) => { job.status = "completed"; });
  const summary = summarizeBlackRoomQueue(state, now);
  assert.deepEqual(summary.progress, {
    remainingPosts: 0,
    remainingBatches: 0,
    remainingDays: 0,
    remainingCalendarDays: 0,
    estimatedFinishDate: null,
  });
});

test("strategy changes replan only queued/retry future jobs and preserve scheduled history", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  state.jobs[0].status = "scheduled";
  const scheduledSlots = structuredClone(state.jobs[0].slots);
  state.jobs[1].status = "retry";
  state.jobs[1].lastError = "old strategy";
  const analytics = { ...state.analytics, creativeStrategy: "context_open_loop" as const, creativeStrategyVersion: 1 };
  const target = state.jobs[1].targetDate;
  applyBlackRoomRemoteCommands(state, [{
    id: "ceo-v1", type: "ceo_schedule", createdAt: now.toISOString(), analytics,
    postsByDate: { [target]: 5 }, slotsByDate: { [target]: ["00:30", "05:00", "09:30", "14:00", "19:00"] },
  }], now);
  assert.deepEqual(state.jobs[0].slots, scheduledSlots);
  assert.equal(state.jobs[0].strategyVersion, 0);
  assert.equal(state.jobs[1].strategyVersion, 1);
  assert.equal(state.jobs[1].strategyReplannedAt, now.toISOString());
  assert.equal(state.jobs[1].lastError, null);
  assert.equal(state.jobs[1].requirements.posts, 5);
});

test("work-now makes only the next pending batch immediately claimable after persistence", async () => {
  const now = new Date("2026-08-26T08:30:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  state.enabled = true;
  state.jobs.forEach((job, index) => { job.notBefore = new Date(now.getTime() + (index + 1) * 86_400_000).toISOString(); });
  const nextId = state.jobs[0].id;
  applyBlackRoomRemoteCommands(state, [{ id: "work-now-1", type: "work_now", createdAt: now.toISOString() }], now);
  assert.equal(state.jobs[0].notBefore, now.toISOString());
  assert.ok(new Date(state.jobs[1].notBefore) > now);
  const directory = await mkdtemp(path.join(tmpdir(), "blackroom-work-now-"));
  const queuePath = path.join(directory, "queue.json");
  await writeBlackRoomQueue(state, queuePath);
  const persisted = await readBlackRoomQueue(queuePath, now);
  assert.equal(claimNextBlackRoomJob(persisted, now)?.id, nextId);
  await unlink(queuePath);
});

test("migrates an old persisted queue into the adaptive release window", async () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  state.jobs.forEach((job) => { job.notBefore = now.toISOString(); });
  const directory = await mkdtemp(path.join(tmpdir(), "blackroom-old-queue-"));
  const queuePath = path.join(directory, "queue.json");
  await writeFile(queuePath, JSON.stringify(state), "utf8");
  const migrated = await readBlackRoomQueue(queuePath, now);
  assert.equal(migrated.jobs.filter((job) => new Date(job.notBefore) <= now).length, 3);
  assert.ok(new Date(migrated.jobs[13].notBefore) > now);
});

test("recovers an interrupted job after its lease expires", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  startBlackRoomAgent(state, 1, now);
  assert.equal(state.bufferDays, 14);
  const claimed = claimNextBlackRoomJob(state, now, 5);
  assert.equal(claimed?.status, "processing");
  assert.equal(recoverInterruptedBlackRoomJobs(state, new Date("2026-07-20T12:06:00.000Z")), 1);
  assert.equal(state.jobs[0].status, "retry");
  assert.match(state.jobs[0].lastError || "", /recuperado automáticamente/);
});

test("retries safely and completes only after explicit confirmation", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  startBlackRoomAgent(state, 1, now);
  const claimed = claimNextBlackRoomJob(state, now)!;
  const retried = retryBlackRoomJob(state, claimed.id, "Chrome cerrado", now);
  assert.equal(retried.status, "retry");
  assert.equal(retried.completedAt, null);
  const completed = completeBlackRoomJob(state, claimed.id, now);
  assert.equal(completed.status, "completed");
  assert.equal(completed.leaseExpiresAt, null);
});

test("starts weeks of work and pause prevents new claims", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  assert.equal(claimNextBlackRoomJob(state, now), null);
  assert.equal(startBlackRoomAgent(state, 2, now), 14);
  assert.equal(state.enabled, true);
  assert.equal(state.bufferDays, 14);
  assert.ok(claimNextBlackRoomJob(state, now));
  pauseBlackRoomAgent(state, now);
  assert.equal(state.enabled, false);
  assert.equal(claimNextBlackRoomJob(state, now), null);
});

test("caps remote quantity and extras while retaining a priority source", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  const commands = [
    { id: "daily-12", type: "daily_target" as const, posts: 12, createdAt: now.toISOString() },
    { id: "extra-3", type: "extra_posts" as const, posts: 3, targetDate: state.jobs[0].targetDate, createdAt: now.toISOString() },
    { id: "source-1", type: "priority_source" as const, url: "https://youtu.be/video123", createdAt: now.toISOString() },
  ];
  assert.equal(applyBlackRoomRemoteCommands(state, commands, now), 2);
  assert.equal(state.postsPerDay, 10);
  assert.equal(state.jobs[0].requirements.posts, 10);
  assert.equal(state.prioritySources[0].status, "pending");
  assert.equal(applyBlackRoomRemoteCommands(state, commands, now), 0);
});

test("applies CEO analytics and learned slots only to pending days", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  const targetDate = state.jobs[0].targetDate;
  const command = {
    id: "ceo-schedule", type: "ceo_schedule" as const, createdAt: now.toISOString(),
    slotsByDate: { [targetDate]: ["00:30", "03:00", "05:30", "08:00", "10:30", "13:00", "15:30", "18:00", "20:30", "23:00"] },
    analytics: {
      sampleCount: 24, comparableSampleCount: 24, lastCheckedAt: now.toISOString(), nextCheckAt: now.toISOString(), confidence: "learning" as const,
      networkSamples: { tiktok: 24, facebook: 24, youtube: 24 }, recommendedTimes: ["13:00"], reason: "learning",
      tiktokMedianViews: 7, tiktokLowViewRate: 0.8, creativeStrategy: "instant_drop" as const,
      creativeStrategyVersion: 1, creativeStrategySampleBaseline: 24, creativeStrategyPostIdsBaseline: [],
      creativeChangedAt: now.toISOString(), creativeReason: "changed",
    },
  };
  assert.equal(applyBlackRoomRemoteCommands(state, [command], now), 1);
  assert.equal(state.analytics.sampleCount, 24);
  assert.deepEqual(state.jobs[0].slots.map((slot) => slot.localTime), command.slotsByDate[targetDate].slice(0, 5));
});

test("daily target changes do not erase extra posts already requested for a date", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  const targetDate = state.jobs[0].targetDate;
  applyBlackRoomRemoteCommands(state, [{ id: "extra", type: "extra_posts", posts: 3, targetDate, createdAt: now.toISOString() }], now);
  applyBlackRoomRemoteCommands(state, [{ id: "daily", type: "daily_target", posts: 8, createdAt: now.toISOString() }], now);
  assert.equal(state.jobs[0].requirements.posts, 10);
});

test("daily target cannot reduce the two-week campaign below five posts", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  applyBlackRoomRemoteCommands(state, [{ id: "daily-low", type: "daily_target", posts: 1, createdAt: now.toISOString() }], now);
  assert.equal(state.postsPerDay, 5);
  assert.equal(state.jobs[0].requirements.posts, 5);
  assert.equal(state.jobs[0].slots.length, 5);
});

test("caps a daily target and extras at ten posts", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  applyBlackRoomRemoteCommands(state, [{ id: "daily-high", type: "daily_target", posts: 15, createdAt: now.toISOString() }], now);
  assert.equal(state.postsPerDay, 10);
  assert.equal(state.jobs[0].requirements.posts, 10);
  applyBlackRoomRemoteCommands(state, [{ id: "extra-over-cap", type: "extra_posts", posts: 3, targetDate: state.jobs[0].targetDate, createdAt: now.toISOString() }], now);
  assert.equal(state.jobs[0].requirements.posts, 10);
});

test("CEO schedule can make a seven-post experiment without changing the five-post baseline", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  const targetDate = state.jobs[0].targetDate;
  const slots = ["00:30", "03:30", "06:30", "09:30", "12:30", "15:30", "18:30"];
  applyBlackRoomRemoteCommands(state, [{
    id: "ceo-seven", type: "ceo_schedule", createdAt: now.toISOString(),
    slotsByDate: { [targetDate]: slots }, postsByDate: { [targetDate]: 7 }, analytics: state.analytics,
  }], now);
  assert.equal(state.postsPerDay, 5);
  assert.equal(state.jobs[0].requirements.posts, 7);
  assert.deepEqual(state.jobs[0].slots.map((slot) => slot.localTime), slots);
});

test("cancels stale queued jobs instead of dumping them after downtime", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");
  const state = createBlackRoomQueueState(new Date("2026-07-20T12:00:00.000Z"));
  ensureBlackRoomScheduleBuffer(state, new Date("2026-07-20T12:00:00.000Z"));
  assert.equal(cancelStaleBlackRoomJobs(state, now), 6);
  assert.equal(state.jobs.filter((job) => job.status === "cancelled").length, 6);
  assert.ok(state.jobs.filter((job) => job.status === "cancelled").every((job) => /vencido/.test(job.lastError || "")));
});

test("enabled health reconciliation renews the future buffer without replaying completed days", () => {
  const start = new Date("2026-07-20T12:00:00.000Z");
  const now = new Date("2026-07-27T12:00:00.000Z");
  const state = createBlackRoomQueueState(start);
  startBlackRoomAgent(state, 2, start);
  for (const job of state.jobs) {
    job.status = "completed";
    job.completedAt = now.toISOString();
  }

  const result = reconcileBlackRoomSchedule(state, now);
  assert.equal(result.recovered, 0);
  assert.equal(result.created, 7);
  assert.equal(state.jobs.filter((job) => job.status === "queued").length, 7);
  assert.deepEqual(state.jobs.filter((job) => job.status === "queued").map((job) => job.targetDate), [
    "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10",
  ]);
  assert.equal(state.jobs.filter((job) => job.targetDate < "2026-07-27").every((job) => job.status === "completed"), true);
});

test("extra today creates exactly the requested future slots when today has no daily batch", () => {
  const now = new Date("2026-07-21T18:00:00.000Z"); // 14:00 America/New_York
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  assert.equal(state.jobs.some((job) => job.targetDate === "2026-07-21"), false);
  applyBlackRoomRemoteCommands(state, [{
    id: "extra-today", type: "extra_posts", posts: 3, targetDate: "2026-07-21", networks: ["facebook", "youtube"], createdAt: now.toISOString(),
  }], now);
  const today = state.jobs.find((job) => job.targetDate === "2026-07-21");
  assert.equal(today?.requirements.posts, 3);
  assert.deepEqual(today?.slots.map((slot) => slot.localTime), ["14:15", "15:45", "17:15"]);
  assert.ok(today?.slots.every((slot) => slot.networks?.join(",") === "facebook,youtube"));
  applyBlackRoomRemoteCommands(state, [{ id: "daily-after-extra", type: "daily_target", posts: 10, createdAt: now.toISOString() }], now);
  assert.ok(today?.slots.every((slot) => slot.networks?.join(",") === "facebook,youtube"));
  applyBlackRoomRemoteCommands(state, [{
    id: "ceo-after-extra", type: "ceo_schedule",
    slotsByDate: { "2026-07-21": ["14:30", "16:00", "17:30"] },
    analytics: state.analytics, createdAt: now.toISOString(),
  }], now);
  assert.ok(today?.slots.every((slot) => slot.networks?.join(",") === "facebook,youtube"));
});

test("extra today creates a fresh actionable batch when the existing batch is terminal", () => {
  for (const status of ["scheduled", "completed"] as const) {
    const now = new Date("2026-07-21T18:00:00.000Z");
    const state = createBlackRoomQueueState(now);
    ensureBlackRoomScheduleBuffer(state, now);
    const terminal = structuredClone(state.jobs[0]);
    terminal.id = "blackroom-tiktok-2026-07-21";
    terminal.targetDate = "2026-07-21";
    terminal.originalTargetDate = "2026-07-21";
    terminal.status = status;
    state.jobs.push(terminal);
    state.extraPostsByDate["2026-07-21"] = 3;

    applyBlackRoomRemoteCommands(state, [{
      id: `extra-after-${status}`, type: "extra_posts", posts: 2, targetDate: "2026-07-21",
      networks: ["facebook", "youtube"], createdAt: now.toISOString(),
    }], now);

    const active = state.jobs.find((job) => job.targetDate === "2026-07-21" && job.status === "queued");
    assert.ok(active);
    assert.notEqual(active.id, terminal.id);
    assert.equal(active.id.endsWith("-extra-extra-after-" + status), true);
    state.enabled = true;
    assert.equal(claimNextBlackRoomJob(state, now)?.id, active.id);
    assert.equal(active.requirements.posts, 2);
    assert.ok(active.slots.every((slot) => slot.networks?.join(",") === "facebook,youtube"));
    assert.equal(terminal.requirements.posts, 5);
  }
});

test("repeated extra-today commands add only the new amount to an ad hoc batch", () => {
  const now = new Date("2026-07-21T18:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  applyBlackRoomRemoteCommands(state, [{ id: "extra-3", type: "extra_posts", posts: 3, targetDate: "2026-07-21", createdAt: now.toISOString() }], now);
  applyBlackRoomRemoteCommands(state, [{ id: "extra-2", type: "extra_posts", posts: 2, targetDate: "2026-07-21", createdAt: now.toISOString() }], now);
  const today = state.jobs.find((job) => job.targetDate === "2026-07-21");
  assert.equal(today?.requirements.posts, 5);
  assert.deepEqual(today?.slots.map((slot) => slot.localTime), ["14:15", "15:45", "17:15", "18:45", "20:15"]);
});

test("migrates existing queued jobs into the long-form experiment", async () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const state = createBlackRoomQueueState(now);
  ensureBlackRoomScheduleBuffer(state, now);
  state.jobs[0].requirements.durationsSeconds = [15, 30, 60];
  state.jobs[0].requirements.minimumClipsPerDuration = 2;
  state.bufferDays = 7;
  const directory = await mkdtemp(path.join(tmpdir(), "blackroom-queue-"));
  const queuePath = path.join(directory, "queue.json");
  await writeBlackRoomQueue(state, queuePath);
  const migrated = await readBlackRoomQueue(queuePath, now);
  assert.equal(migrated.version, 4);
  assert.equal(migrated.bufferDays, 14);
  assert.deepEqual(migrated.jobs[0].requirements.durationsSeconds, [15, 30, 60, 120, 300, 600]);
  assert.equal(migrated.jobs[0].requirements.minimumClipsPerDuration, 1);
});

test("serializes concurrent queue mutations without losing source history", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "blackroom-queue-lock-"));
  const queuePath = path.join(directory, "queue.json");
  await writeBlackRoomQueue(createBlackRoomQueueState(), queuePath);
  const mutate = (videoId: string, delayMs: number) => withBlackRoomQueueLock(queuePath, async () => {
    const state = await readBlackRoomQueue(queuePath);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    recordBlackRoomSourceUsage(state, {
      videoId, jobId: "job-1", dj: "DJ Test", format: "vertical", language: "en",
      durationSeconds: 15, segmentStartSeconds: 0, segmentEndSeconds: 15,
    });
    await writeBlackRoomQueue(state, queuePath);
  });
  await Promise.all([mutate("video-a", 50), mutate("video-b", 0)]);
  const finalState = await readBlackRoomQueue(queuePath);
  assert.deepEqual(finalState.sourceHistory.map((item) => item.videoId).sort(), ["video-a", "video-b"]);
});

test("records a failed download separately from published source history", () => {
  const state = createBlackRoomQueueState(new Date("2026-07-28T12:00:00.000Z"));
  const recorded = recordBlackRoomFailedSource(state, "failed-video", "yt-dlp timed out", new Date("2026-07-28T12:01:00.000Z"));
  assert.equal(recorded.videoId, "failed-video");
  assert.equal(state.sourceHistory.length, 0);
  assert.deepEqual(state.failedSourceVideos.map((item) => item.videoId), ["failed-video"]);
});

test("does not steal a newly created lock before its PID is written", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "blackroom-empty-lock-"));
  const queuePath = path.join(directory, "queue.json");
  const lockPath = `${queuePath}.lock`;
  await writeFile(lockPath, "", "utf8");
  let entered = false;
  await assert.rejects(
    withBlackRoomQueueLock(queuePath, async () => { entered = true; }, 75),
    /Timed out waiting/,
  );
  assert.equal(entered, false);
  await unlink(lockPath);
});
