import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createClipperLocalNewsScheduler,
  getClipperLocalNewsSchedulerConfig,
} from "../server/clippers-local-news-scheduler";

function fakeTimer() {
  return { unref() {} } as ReturnType<typeof setInterval>;
}

test("server startup wires the local-news scheduler alongside existing schedulers", async () => {
  const source = await readFile(new URL("../server/index.ts", import.meta.url), "utf8");
  assert.match(source, /import\("\.\/clippers-local-news-scheduler"\)/);
  assert.match(source, /localNews\.startClipperLocalNewsScheduler\(\);/);
  assert.match(source, /metricoolAnalytics\.startMetricoolAnalyticsScheduler\(\);/);
  assert.match(source, /if \(shouldStartResourceIntensiveSchedulers\(\)\) \{\s+startPromoVideoDailyScheduler\(\);\s+startCybersecurityScheduler\(\);\s+startAppQaScheduler\(\);\s+void import\("\.\/local-news-growth-scout"\)/);
});

test("uses a five-minute default and clamps configured intervals to the safe two-to-five-minute range", () => {
  assert.deepEqual(getClipperLocalNewsSchedulerConfig({}), {
    enabled: true,
    intervalMs: 5 * 60_000,
    timeoutMs: 240_000,
  });
  assert.deepEqual(getClipperLocalNewsSchedulerConfig({ CLIPPERS_LOCAL_NEWS_INTERVAL_MINUTES: "1" }), {
    enabled: true,
    intervalMs: 2 * 60_000,
    timeoutMs: 2 * 60_000 - 1_000,
  });
  assert.equal(getClipperLocalNewsSchedulerConfig({ CLIPPERS_LOCAL_NEWS_INTERVAL_MINUTES: "30" }).intervalMs, 5 * 60_000);
  assert.equal(getClipperLocalNewsSchedulerConfig({ CLIPPERS_LOCAL_NEWS_SCHEDULER_ENABLED: "false" }).enabled, false);
});

test("starts immediately, schedules every five minutes, unrefs the timer, and can stop", async () => {
  let scheduledDelay = 0;
  let scheduledCallback: (() => void) | undefined;
  let unrefCount = 0;
  let clearCount = 0;
  let bootstrapCount = 0;
  let cycleCount = 0;
  const interval = { unref: () => { unrefCount += 1; } } as ReturnType<typeof setInterval>;
  const scheduler = createClipperLocalNewsScheduler({
    env: {},
    bootstrap: async () => { bootstrapCount += 1; return {} as never; },
    runCycle: async () => { cycleCount += 1; return {} as never; },
    deliver: async () => ({ status: "paused" } as never),
    setInterval: (callback, delay) => { scheduledCallback = callback; scheduledDelay = delay; return interval; },
    clearInterval: (timer) => { assert.equal(timer, interval); clearCount += 1; },
    setTimeout: () => fakeTimer(),
    clearTimeout: () => {},
    log: () => {},
  });

  assert.equal(scheduler.start().started, true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(scheduledDelay, 5 * 60_000);
  assert.equal(unrefCount, 1);
  assert.equal(bootstrapCount, 1);
  assert.equal(cycleCount, 1);
  assert.equal(scheduler.status().completedCount, 1);

  scheduledCallback?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(cycleCount, 2);
  assert.equal(scheduler.stop().started, false);
  assert.equal(clearCount, 1);
});

test("disabled scheduler does not schedule or run work", async () => {
  let touched = false;
  const scheduler = createClipperLocalNewsScheduler({
    env: { CLIPPERS_LOCAL_NEWS_SCHEDULER_ENABLED: "false" },
    bootstrap: async () => { touched = true; return {} as never; },
    runCycle: async () => { touched = true; return {} as never; },
    setInterval: () => { touched = true; return fakeTimer(); },
  });

  assert.equal(scheduler.start().started, false);
  assert.equal(await scheduler.runNow(), "skipped");
  assert.equal(touched, false);
});

test("overlap lock skips a second tick until the first cycle settles", async () => {
  let release: (() => void) | undefined;
  const cycle = new Promise<void>((resolve) => { release = resolve; });
  const scheduler = createClipperLocalNewsScheduler({
    env: {},
    bootstrap: async () => ({} as never),
    runCycle: async () => { await cycle; return {} as never; },
    setTimeout: () => fakeTimer(),
    clearTimeout: () => {},
    logError: () => {},
  });

  const first = scheduler.runNow();
  assert.equal(await scheduler.runNow(), "skipped");
  assert.equal(scheduler.status().running, true);
  release?.();
  assert.equal(await first, "completed");
  assert.equal(scheduler.status().skippedCount, 1);
  assert.equal(scheduler.status().running, false);
});

test("timeout is isolated and retains the overlap lock until work actually settles", async () => {
  let fireTimeout: (() => void) | undefined;
  let release: (() => void) | undefined;
  const cycle = new Promise<void>((resolve) => { release = resolve; });
  const errors: string[] = [];
  const scheduler = createClipperLocalNewsScheduler({
    env: { CLIPPERS_LOCAL_NEWS_TIMEOUT_MS: "1000" },
    bootstrap: async () => ({} as never),
    runCycle: async (options) => { assert.equal(typeof options.fetch, "function"); await cycle; return {} as never; },
    setTimeout: (callback) => { fireTimeout = callback; return fakeTimer(); },
    clearTimeout: () => {},
    logError: (message) => errors.push(message),
  });

  const first = scheduler.runNow();
  await new Promise<void>((resolve) => setImmediate(resolve));
  fireTimeout?.();
  assert.equal(await first, "timed_out");
  assert.equal(scheduler.status().timeoutCount, 1);
  assert.equal(scheduler.status().lastTimeoutPhase, "ingest");
  assert.equal(scheduler.status().lastError, "timeout:ingest");
  assert.equal(scheduler.status().running, true);
  assert.equal(await scheduler.runNow(), "skipped");
  assert.equal(errors.length, 1);
  release?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(scheduler.status().running, false);
});

test("timeout aborts outstanding source requests so a hung network call cannot lock every future cycle", async () => {
  let fireTimeout: (() => void) | undefined;
  let fetchAborted = false;
  const scheduler = createClipperLocalNewsScheduler({
    env: { CLIPPERS_LOCAL_NEWS_TIMEOUT_MS: "1000" },
    bootstrap: async () => ({} as never),
    runCycle: async (options) => {
      await options.fetch?.("https://official.example/news");
      return {} as never;
    },
    fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const rejectAborted = () => {
        fetchAborted = true;
        reject(new Error("aborted"));
      };
      if (init?.signal?.aborted) rejectAborted();
      else init?.signal?.addEventListener("abort", rejectAborted, { once: true });
    }),
    setTimeout: (callback) => { fireTimeout = callback; return fakeTimer(); },
    clearTimeout: () => {},
    logError: () => {},
  });

  const first = scheduler.runNow();
  fireTimeout?.();
  assert.equal(await first, "timed_out");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fetchAborted, true);
  assert.equal(scheduler.status().running, false);
});

test("timeout identifies Metricool delivery and releases the lock when its request observes abort", async () => {
  let fireTimeout: (() => void) | undefined;
  let deliveryAborted = false;
  const scheduler = createClipperLocalNewsScheduler({
    env: { CLIPPERS_LOCAL_NEWS_TIMEOUT_MS: "1000" },
    bootstrap: async () => ({} as never),
    runCycle: async () => ({ status: {} } as never),
    deliver: async (options) => {
      await options.fetch?.("https://app.metricool.com/api/v2/scheduler/posts");
      return {} as never;
    },
    fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const rejectAborted = () => {
        deliveryAborted = true;
        reject(new Error("aborted"));
      };
      if (init?.signal?.aborted) rejectAborted();
      else init?.signal?.addEventListener("abort", rejectAborted, { once: true });
    }),
    setTimeout: (callback) => { fireTimeout = callback; return fakeTimer(); },
    clearTimeout: () => {},
    log: () => {},
    logError: () => {},
  });

  const first = scheduler.runNow();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(scheduler.status().currentPhase, "delivery");
  fireTimeout?.();
  assert.equal(await first, "timed_out");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(deliveryAborted, true);
  assert.equal(scheduler.status().lastTimeoutPhase, "delivery");
  assert.equal(scheduler.status().running, false);
});

test("cycle errors are contained without logging their potentially sensitive message", async () => {
  const logs: string[] = [];
  const scheduler = createClipperLocalNewsScheduler({
    env: {},
    bootstrap: async () => ({} as never),
    runCycle: async () => { throw new Error("token=do-not-log https://feed.example/private?key=secret"); },
    setTimeout: () => fakeTimer(),
    clearTimeout: () => {},
    logError: (message) => logs.push(message),
  });

  assert.equal(await scheduler.runNow(), "failed");
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /do-not-log|secret|feed\.example/);
  assert.match(scheduler.status().lastError || "", /\[redacted\]|\[url\]/);
});

test("runs Metricool delivery after a successful cycle using the cycle status", async () => {
  const cycleStatus = { artifacts: { queue: "/tmp/metricool-queue.json" } } as never;
  const order: string[] = [];
  const logs: string[] = [];
  let deliveredStatus: unknown;
  const scheduler = createClipperLocalNewsScheduler({
    env: {},
    bootstrap: async () => { order.push("bootstrap"); return {} as never; },
    runCycle: async () => { order.push("cycle"); return { status: cycleStatus, fetchedSources: 8, failedSources: [], created: 3, queued: 6 } as never; },
    deliver: async (options) => {
      order.push("deliver");
      deliveredStatus = options.status;
      return { status: "ready", scheduled: 4, alreadyScheduled: 2 } as never;
    },
    setTimeout: () => fakeTimer(),
    clearTimeout: () => {},
    logError: () => {},
    log: (message) => logs.push(message),
  });

  assert.equal(await scheduler.runNow(), "completed");
  assert.deepEqual(order, ["bootstrap", "cycle", "deliver"]);
  assert.equal(deliveredStatus, cycleStatus);
  assert.match(logs.find((message) => message.includes("cycle completed")) || "", /sources=8; sourceFailures=0; created=3; queued=6; delivery=ready; scheduled=4; alreadyScheduled=2/);
  assert.deepEqual(logs.filter((message) => message.includes("cycle phase=")).map((message) => message.match(/phase=(\w+)/)?.[1]), ["start", "bootstrapped", "ingested", "delivered"]);
});
