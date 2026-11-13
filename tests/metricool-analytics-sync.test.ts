import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createMetricoolAnalyticsScheduler,
  getMetricoolAnalyticsSyncConfig,
  getMetricoolAnalyticsSyncStatus,
  parseMetricoolMcpPostMetrics,
  parseMetricoolPostMetrics,
  syncMetricoolAnalytics,
} from "../server/metricool-analytics-sync";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

test("parses Metricool post metrics without trusting a single provider field", () => {
  const parsed = parseMetricoolPostMetrics({ data: [{ id: "post-1", publicationDate: "2026-07-26T12:00:00Z", views: 42, reactions: 3, comments: 1, shares: 2, linkClicks: 4 }] });
  assert.deepEqual(parsed, [{ postId: "post-1", queueItemId: null, contentHash: null, observedAt: "2026-07-26T12:00:00Z", impressions: 42, reach: 0, videoViews: 0, engagements: 10, clicks: 4, shares: 2 }]);
  assert.deepEqual(parseMetricoolPostMetrics({ data: [{ postId: "nested-1", publicationDate: { dateTime: "2026-07-26T12:00:00Z" }, metrics: { views: 9, reach: 7, videoViews: 6, reactions: 1 } }] }), [{ postId: "nested-1", queueItemId: null, contentHash: null, observedAt: "2026-07-26T12:00:00Z", impressions: 9, reach: 7, videoViews: 6, engagements: 1, clicks: 0, shares: 0 }]);
});

test("parses official Metricool MCP Facebook post fields", () => {
  const parsed = parseMetricoolMcpPostMetrics({ content: [{ type: "text", text: JSON.stringify({ rows: [{
    FBPO02: "2026-08-11T14:00:00-04:00",
    FBPO03: "Bilingual local update",
    FBPO04: "facebook-post-1",
    FBPO08: 2,
    FBPO09: 3,
    FBPO11: 120,
    FBPO12: 100,
    FBPO13: 5,
    FBPO14: 1,
    FBPO16: 70,
  }] }) }] });
  assert.deepEqual(parsed, [{
    postId: "facebook-post-1",
    queueItemId: null,
    contentHash: "cd9ca433093a165331dabccc1b3ca1ee3d5488ff0ed3c0024c6252d97d541d32",
    observedAt: "2026-08-11T14:00:00-04:00",
    impressions: 120,
    reach: 100,
    videoViews: 70,
    engagements: 11,
    clicks: 3,
    shares: 1,
  }]);
});

test("falls back to the official Metricool MCP when the undocumented analytics endpoint is empty", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "metricool-analytics-mcp-"));
  await writeFile(path.join(workspaceDir, "metricool-delivery-ledger.json"), JSON.stringify({ entries: [{
    queueItemId: "queue-mcp",
    eventId: "event-mcp",
    lane: "miami-news",
    platform: "facebook",
    blogId: "miami-1",
    metricoolPostId: "facebook-post-1",
    scheduledFor: "2026-08-11T18:00:00.000Z",
  }] }));
  let mcpCalls = 0;
  const result = await syncMetricoolAnalytics({
    workspaceDir,
    env: { METRICOOL_USER_TOKEN: "configured-token", METRICOOL_USER_ID: "3558197" },
    now: () => new Date("2026-08-12T15:00:00Z"),
    fetch: async (input, init) => {
      const url = String(input);
      if (url.includes("simpleProfiles")) return response({ data: [{ blogId: "miami-1", label: "Miami News" }] });
      if (url.includes("analytics/posts/facebook")) return response({ data: [] });
      if (url === "https://ai.metricool.com/mcp") {
        mcpCalls += 1;
        const request = JSON.parse(String(init?.body));
        assert.equal(request.params.name, "getAnalyticsDataByMetrics");
        assert.equal(request.params.arguments.brandId, "miami-1");
        return response({ result: { content: [{ type: "text", text: JSON.stringify({ rows: [{
          FBPO02: "2026-08-11T14:00:00-04:00",
          FBPO04: "facebook-post-1",
          FBPO11: 120,
          FBPO13: 5,
        }] }) }], isError: false } });
      }
      return response({ data: [] });
    },
  });
  assert.equal(mcpCalls, 1);
  assert.equal(result.status, "partial", "the disconnected New York brand remains visible as a partial readiness issue");
  assert.equal(result.postsSeen, 1);
  assert.equal(result.metricsRecorded, 1);
});

test("splits an oversized Metricool MCP analytics range and merges the smaller responses", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "metricool-analytics-split-"));
  await writeFile(path.join(workspaceDir, "metricool-delivery-ledger.json"), JSON.stringify({ entries: [
    { queueItemId: "queue-left", eventId: "event-left", lane: "miami-news", platform: "facebook", blogId: "miami-1", metricoolPostId: "post-left", scheduledFor: "2026-07-25T14:00:00.000Z" },
    { queueItemId: "queue-right", eventId: "event-right", lane: "miami-news", platform: "facebook", blogId: "miami-1", metricoolPostId: "post-right", scheduledFor: "2026-08-10T14:00:00.000Z" },
  ] }));
  let mcpCalls = 0;
  const result = await syncMetricoolAnalytics({
    workspaceDir,
    env: { METRICOOL_USER_TOKEN: "configured-token", METRICOOL_USER_ID: "3558197" },
    now: () => new Date("2026-08-12T15:00:00Z"),
    fetch: async (input, init) => {
      const url = String(input);
      if (url.includes("simpleProfiles")) return response({ data: [{ blogId: "miami-1", label: "Miami News" }] });
      if (url.includes("analytics/posts/facebook")) return response({ data: [] });
      if (url === "https://ai.metricool.com/mcp") {
        mcpCalls += 1;
        const request = JSON.parse(String(init?.body));
        const from = new Date(request.params.arguments.from).getTime();
        const to = new Date(request.params.arguments.to).getTime();
        if (to - from > 16 * 86_400_000) {
          return response({ result: { content: [{ type: "text", text: "The result exceeds maximum allowed size. Narrow the query." }], isError: true } });
        }
        const postId = from < new Date("2026-07-28T00:00:00Z").getTime() ? "post-left" : "post-right";
        const publicationDate = postId === "post-left" ? "2026-07-25T14:00:00Z" : "2026-08-10T14:00:00Z";
        return response({ result: { content: [{ type: "text", text: JSON.stringify({ rows: [{ FBPO02: publicationDate, FBPO04: postId, FBPO11: 25 }] }) }], isError: false } });
      }
      return response({ data: [] });
    },
  });
  assert.equal(mcpCalls, 3);
  assert.equal(result.postsSeen, 2);
  assert.equal(result.metricsRecorded, 2);
  assert.doesNotMatch(result.lastError || "", /maximum allowed size|narrow the query/i);
});

test("syncs Facebook analytics for both local-news brands and deduplicates observations", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "metricool-analytics-"));
  await writeFile(path.join(workspaceDir, "metricool-delivery-ledger.json"), JSON.stringify({ entries: [
    { queueItemId: "queue-1", eventId: "event-1", lane: "miami-news", platform: "facebook", blogId: "miami-1", metricoolPostId: "post-1" },
    { queueItemId: "queue-2", eventId: "event-2", lane: "ny-news", platform: "facebook", blogId: "ny-1", metricoolPostId: "post-2" },
  ] }));
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("simpleProfiles")) return response({ data: [{ blogId: "miami-1", label: "Miami News", networks: ["facebook"] }, { blogId: "ny-1", label: "New York News", networks: ["facebook"] }] });
    if (url.includes("blogId=miami-1")) return response({ data: [
      { id: "post-1", publicationDate: "2026-07-26T12:00:00Z", views: 42, reactions: 3, comments: 1, shares: 2, linkClicks: 4 },
      { id: "external-1", publicationDate: "2026-07-26T12:30:00Z", views: 100, reactions: 10 },
    ] });
    if (url.includes("blogId=ny-1")) return response({ data: [{ id: "post-2", jobId: "queue-2", publicationDate: "2026-07-26T13:00:00Z", reach: 8, reactions: 1 }] });
    return response({ error: "not found" }, 404);
  };
  const env = { METRICOOL_USER_TOKEN: "configured-token", METRICOOL_USER_ID: "3558197", CLIPPERS_LOCAL_NEWS_WORKSPACE: workspaceDir };
  const first = await syncMetricoolAnalytics({ env, workspaceDir, fetch: fetcher, now: () => new Date("2026-07-27T15:00:00Z") });
  assert.equal(first.status, "completed");
  assert.equal(first.postsSeen, 3);
  assert.equal(first.metricsRecorded, 2);
  assert.equal(first.unmatchedSkipped, 1);
  assert.equal(first.brands.filter((brand) => brand.connected).length, 2);
  assert.equal(calls.filter((url) => url.includes("analytics/posts/facebook")).length, 2);
  const state = JSON.parse(await readFile(path.join(workspaceDir, "state.json"), "utf8"));
  assert.equal(state.metrics.length, 2);
  assert.equal(state.metrics.find((metric: any) => metric.queueItemId === "queue-1")?.impressions, 42);

  const second = await syncMetricoolAnalytics({ env, workspaceDir, fetch: fetcher, now: () => new Date("2026-07-27T15:01:00Z") });
  assert.equal(second.status, "completed");
  assert.equal(second.metricsRecorded, 0);
  assert.equal(second.duplicatesSkipped, 2);
  const publicStatus = await getMetricoolAnalyticsSyncStatus({ workspaceDir, env: { METRICOOL_ANALYTICS_SYNC_ENABLED: "false" } });
  assert.equal(publicStatus.enabled, false);
  assert.equal(publicStatus.configured, false);
  assert.equal("seen" in publicStatus, false);
});

test("recognizes pre-upgrade analytics fingerprints after reach and video-view fields are added", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "metricool-analytics-legacy-fingerprint-"));
  const post = { postId: "post-legacy", queueItemId: null, contentHash: null, observedAt: "2026-07-26T12:00:00Z", impressions: 42, engagements: 3, clicks: 0, shares: 0 };
  const { createHash } = await import("node:crypto");
  const legacyFingerprint = createHash("sha256").update(JSON.stringify(["miami-news", "miami-1", post])).digest("hex");
  await writeFile(path.join(workspaceDir, "metricool-delivery-ledger.json"), JSON.stringify({ entries: [
    { queueItemId: "queue-legacy", eventId: "event-legacy", lane: "miami-news", platform: "facebook", blogId: "miami-1", metricoolPostId: "post-legacy" },
  ] }));
  await writeFile(path.join(workspaceDir, "metricool-analytics-sync.json"), JSON.stringify({ seen: [legacyFingerprint] }));
  const result = await syncMetricoolAnalytics({
    workspaceDir,
    env: { METRICOOL_USER_TOKEN: "configured-token", METRICOOL_USER_ID: "3558197" },
    now: () => new Date("2026-07-27T15:00:00Z"),
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("simpleProfiles")) return response({ data: [{ blogId: "miami-1", label: "Miami News" }] });
      if (url.includes("blogId=miami-1")) return response({ data: [{ id: "post-legacy", publicationDate: post.observedAt, impressions: 42, reactions: 3 }] });
      return response({ data: [] });
    },
  });
  assert.equal(result.metricsRecorded, 0);
  assert.equal(result.duplicatesSkipped, 1);
});

test("daily scheduler runs at the configured New York time and records a single run per date", async () => {
  let now = new Date("2026-07-27T10:45:00Z");
  let tick: (() => void) | undefined;
  let syncCount = 0;
  const scheduler = createMetricoolAnalyticsScheduler({
    env: { METRICOOL_ANALYTICS_SYNC_HOUR: "6", METRICOOL_ANALYTICS_SYNC_MINUTE: "45" },
    now: () => now,
    setInterval: (callback) => { tick = callback; return { unref() {} }; },
    clearInterval: () => {},
    sync: async () => { syncCount += 1; return { enabled: true, configured: true, lastRunAt: now.toISOString(), lastSuccessAt: now.toISOString(), lastError: null, brands: [], postsSeen: 1, metricsRecorded: 1, duplicatesSkipped: 0, lookbackDays: 30, source: "metricool", status: "completed" }; },
    getUserIds: async () => [],
    recordRun: async () => null,
    log: () => {},
  });
  scheduler.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(syncCount, 1);
  tick?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(syncCount, 1);
  now = new Date("2026-07-28T10:45:00Z");
  tick?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(syncCount, 2);
  scheduler.stop();
});

test("daily scheduler catches up after a Replit restart misses the exact configured minute", async () => {
  let now = new Date("2026-07-27T15:20:00Z"); // 11:20 America/New_York
  let tick: (() => void) | undefined;
  let syncCount = 0;
  const scheduler = createMetricoolAnalyticsScheduler({
    env: { METRICOOL_ANALYTICS_SYNC_HOUR: "6", METRICOOL_ANALYTICS_SYNC_MINUTE: "45" },
    now: () => now,
    setInterval: (callback) => { tick = callback; return { unref() {} }; },
    clearInterval: () => {},
    sync: async () => { syncCount += 1; return { enabled: true, configured: true, lastRunAt: now.toISOString(), lastSuccessAt: now.toISOString(), lastError: null, brands: [], postsSeen: 0, metricsRecorded: 0, duplicatesSkipped: 0, unmatchedSkipped: 0, lookbackDays: 30, source: "metricool", status: "completed" }; },
    getUserIds: async () => [],
    recordRun: async () => null,
    log: () => {},
  });
  scheduler.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(syncCount, 1);
  tick?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(syncCount, 1, "catch-up remains once per New York date");
  now = new Date("2026-07-28T10:44:00Z");
  tick?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(syncCount, 1, "the next date still waits until its configured deadline");
});

test("uses a daily 06:45 default and can be disabled without touching credentials", () => {
  assert.deepEqual(getMetricoolAnalyticsSyncConfig({}), { enabled: true, hour: 6, minute: 45, lookbackDays: 30, timeoutMs: 30_000 });
  assert.equal(getMetricoolAnalyticsSyncConfig({ METRICOOL_ANALYTICS_SYNC_ENABLED: "false" }).enabled, false);
});

for (const scenario of ["manual-timeout", "scheduled-timeout", "manual-rejection"]) {
  test(`scheduler contains ${scenario} failure without terminating HTTP service`, { timeout: 25_000 }, () => {
    // A separate strict Node process proves there is no unhandled rejection.
    // All integration dependencies are fake; no app startup or credentials.
    const script = `
      import assert from "node:assert/strict";
      import { createServer } from "node:http";
      import { createMetricoolAnalyticsScheduler } from "./server/metricool-analytics-sync.ts";
      const scenario = ${JSON.stringify(scenario)};
      const errors = [];
      const recorded = [];
      let recover = false;
      let syncCount = 0;
      let tick;
      const now = () => new Date("2026-07-27T15:20:00Z");
      const scheduler = createMetricoolAnalyticsScheduler({
        env: { METRICOOL_ANALYTICS_SYNC_TIMEOUT_MS: "5000" },
        now,
        sync: async () => {
          syncCount++;
          if (!recover) {
            if (scenario === "manual-rejection") throw new Error("provider_unavailable");
            return new Promise(() => {});
          }
          return {
            enabled: true, configured: true, lastRunAt: now().toISOString(),
            lastSuccessAt: now().toISOString(), lastError: null, brands: [],
            postsSeen: 0, metricsRecorded: 0, duplicatesSkipped: 0,
            unmatchedSkipped: 0, lookbackDays: 30, source: "metricool",
            status: "completed",
          };
        },
        setInterval: callback => { tick = callback; return { unref() {} }; },
        clearInterval: () => {},
        getUserIds: async () => ["test-user"],
        recordRun: async (...args) => { recorded.push(args[3]); return null; },
        log: () => {},
        logError: message => errors.push(message),
      });
      const server = createServer((_req, res) => res.end("still alive"));
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const url = "http://127.0.0.1:" + server.address().port;
      const assertServing = async () => {
        const response = await fetch(url);
        assert.equal(response.status, 200);
        assert.equal(await response.text(), "still alive");
      };
      try {
        await assertServing();
        if (scenario === "scheduled-timeout") {
          scheduler.start(); // exercise the unawaited catch-up path
          const deadline = Date.now() + 10_000;
          while (!scheduler.status().lastError) {
            assert.ok(Date.now() < deadline, "scheduler did not report its failure");
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        } else {
          assert.equal(await scheduler.runNow(), "failed");
        }
        // Let Node process rejected promises before proving HTTP still works.
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        const error = scenario === "manual-rejection" ? "provider_unavailable" : "analytics_sync_timeout";
        assert.equal(scheduler.status().lastError, error);
        assert.equal(scheduler.status().completedCount, 0);
        assert.equal(scheduler.status().runCount, 1);
        assert.equal(scheduler.status().running, false);
        assert.ok(scheduler.status().lastFinishedAt);
        assert.deepEqual(errors, ["[Metricool analytics] " + error]);
        assert.equal(recorded.length, 0, "failure must not record a successful run");
        await assertServing();
        if (tick) {
          tick();
          assert.equal(syncCount, 1, "failure must not add automatic retries");
        }
        recover = true;
        assert.equal(await scheduler.runNow(), "completed");
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(scheduler.status().completedCount, 1);
        assert.equal(scheduler.status().lastError, null);
        assert.equal(recorded.length, 1);
        assert.equal(recorded[0].status, "success");
        await assertServing();
        console.log("FAILURE_CONTAINED_HTTP_ALIVE_RECOVERY_OK");
      } finally {
        scheduler.stop();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    `;
    const child = spawnSync(process.execPath, [
      "--unhandled-rejections=strict", "--import", "tsx", "--input-type=module", "--eval", script,
    ], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, NODE_ENV: "test" },
      encoding: "utf8",
      timeout: 20_000,
    });
    assert.ifError(child.error);
    assert.equal(child.signal, null, child.stderr);
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /FAILURE_CONTAINED_HTTP_ALIVE_RECOVERY_OK/);
  });
}

test("fails closed when credentials exist but neither local-news brand is connected", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "metricool-analytics-blocked-"));
  const result = await syncMetricoolAnalytics({
    workspaceDir,
    env: { METRICOOL_USER_TOKEN: "configured-token", METRICOOL_USER_ID: "3558197" },
    fetch: async () => response({ data: [{ blogId: "other", label: "Other Brand" }] }),
    now: () => new Date("2026-07-27T15:00:00Z"),
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.lastError, "metricool_news_brands_not_connected");
  assert.equal(result.metricsRecorded, 0);
});

test("matches an owned post by copy hash when Metricool omits the delivery and queue IDs", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "metricool-analytics-copy-match-"));
  const copy = "ESPAÑOL / ENGLISH | Cierre verificado en Miami. Fuente oficial: https://example.gov/road";
  const normalized = copy.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("es-US");
  const { createHash } = await import("node:crypto");
  const copyHash = createHash("sha256").update(normalized, "utf8").digest("hex");
  await writeFile(path.join(workspaceDir, "metricool-delivery-ledger.json"), JSON.stringify({ entries: [
    { queueItemId: "queue-copy", eventId: "event-copy", lane: "miami-news", platform: "facebook", blogId: "miami-1", metricoolPostId: null, copyHash },
  ] }));
  const result = await syncMetricoolAnalytics({
    workspaceDir,
    env: { METRICOOL_USER_TOKEN: "configured-token", METRICOOL_USER_ID: "3558197" },
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("simpleProfiles")) return response({ data: [{ blogId: "miami-1", label: "Miami News" }] });
      if (url.includes("blogId=miami-1")) return response({ data: [{ id: "provider-id", text: copy, publicationDate: "2026-07-27T14:00:00Z", impressions: 12, reactions: 2 }] });
      return response({ data: [] });
    },
    now: () => new Date("2026-07-27T15:00:00Z"),
  });
  assert.equal(result.status, "partial");
  assert.equal(result.metricsRecorded, 1);
  assert.equal(result.unmatchedSkipped, 0);
});

test("does not advance lastSuccessAt when every connected analytics request fails", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "metricool-analytics-errors-"));
  const env = { METRICOOL_USER_TOKEN: "configured-token", METRICOOL_USER_ID: "3558197" };
  const now = new Date("2026-07-27T15:00:00Z");
  const result = await syncMetricoolAnalytics({
    workspaceDir,
    env,
    fetch: async (input) => String(input).includes("simpleProfiles")
      ? response({ data: [{ blogId: "miami-1", label: "Miami News" }, { blogId: "ny-1", label: "New York News" }] })
      : response({ error: "denied" }, 403),
    now: () => now,
  });
  assert.equal(result.status, "partial");
  assert.equal(result.lastSuccessAt, null);
  assert.match(result.lastError || "", /plan_required/);
});

test("serializes overlapping manual and scheduled sync calls", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "metricool-analytics-lock-"));
  let profileCalls = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("simpleProfiles")) {
      profileCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return response({ data: [] });
    }
    return response({ data: [] });
  };
  const env = { METRICOOL_USER_TOKEN: "configured-token", METRICOOL_USER_ID: "3558197" };
  const [first, second] = await Promise.all([
    syncMetricoolAnalytics({ env, workspaceDir, fetch: fetcher, now: () => new Date("2026-07-27T15:00:00Z") }),
    syncMetricoolAnalytics({ env, workspaceDir, fetch: fetcher, now: () => new Date("2026-07-27T15:00:01Z") }),
  ]);
  assert.equal(profileCalls, 1);
  assert.equal(first.status, "blocked");
  assert.deepEqual(second, first);
});

test("server startup wires the Metricool analytics scheduler", async () => {
  const source = await readFile(new URL("../server/index.ts", import.meta.url), "utf8");
  assert.match(source, /import\("\.\/metricool-analytics-sync"\)/);
  assert.match(source, /localNews\.startClipperLocalNewsScheduler\(\);[\s\S]*?metricoolAnalytics\.startMetricoolAnalyticsScheduler\(\);/);
});
