import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseBlackRoomTeamStatus } from "../shared/blackroom-team";
import { createBlackRoomTeamContext } from "../server/blackroom-team";
import defaultAgent, {
  BLACKROOM_ANALYTICS_TOKEN_NEED,
  createBlackRoomAnalyticsAgent,
  createReadOnlyMetricoolFetch,
  type BlackRoomAnalyticsSourceState,
} from "../server/blackroom-team/blackroom-analytics";
import { buildBlackRoomAnalyticsReport } from "../server/blackroom-team/blackroom-analytics/report";

const NOW = new Date("2026-11-12T17:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

async function withDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "br-analytics-"));
  try { return await work(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

const failingFetch = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;

function sourceState(): BlackRoomAnalyticsSourceState {
  return {
    analyticsImports: {
      tiktok: {
        importedAt: hoursAgo(2),
        samples: [
          // current week
          { id: "tt-a", views: 1200, likes: 90, comments: 10, shares: 5, publishedAt: hoursAgo(24), durationSeconds: 20 },
          { id: "tt-b", views: 800, likes: 40, comments: 3, shares: 1, publishedAt: hoursAgo(48), durationSeconds: 25 },
          { id: "tt-c", views: 5, likes: 0, comments: 0, shares: 0, publishedAt: hoursAgo(72), durationSeconds: 60 },
          { id: "tt-d", views: 8, likes: 1, comments: 0, shares: 0, publishedAt: hoursAgo(96), durationSeconds: 55 },
          // previous week
          { id: "tt-e", views: 300, likes: 20, comments: 2, shares: 0, publishedAt: hoursAgo(24 * 8), durationSeconds: 20 },
          { id: "tt-f", views: 200, likes: 10, comments: 1, shares: 0, publishedAt: hoursAgo(24 * 9), durationSeconds: 58 },
          { id: "tt-undated", views: 50 },
          { id: "bad", views: "x" },
        ],
      },
      youtube: {
        importedAt: hoursAgo(3),
        samples: [
          { id: "yt-a", views: 100, publishedAt: hoursAgo(30) },
          { id: "yt-b", views: 400, publishedAt: hoursAgo(24 * 8) },
          { id: "yt-c", views: 400, publishedAt: hoursAgo(24 * 10) },
        ],
      },
    },
    commands: [
      { type: "ceo_schedule", analytics: { networkSamples: { tiktok: 40, facebook: 12, youtube: 9 }, networkErrors: { facebook: "sin detalle" }, lastCheckedAt: hoursAgo(5) } },
    ],
  };
}

test("report: totals, deltas, top/bottom, missing networks and 3-5 recommendations (deterministic)", () => {
  const source = sourceState()!;
  const report = buildBlackRoomAnalyticsReport({
    window: "weekly",
    now: NOW,
    samplesByNetwork: {
      tiktok: source.analyticsImports!.tiktok!.samples as never,
      youtube: source.analyticsImports!.youtube!.samples as never,
    },
    coverage: { networkSamples: { facebook: 12 }, networkErrors: {} },
  });
  const tiktok = report.networks.tiktok;
  assert.equal(tiktok.status, "ok");
  assert.equal(tiktok.current.posts, 4);
  assert.equal(tiktok.current.views, 2013);
  assert.equal(tiktok.previous.views, 500);
  assert.equal(tiktok.deltas.views.changePct, 302.6);
  assert.equal(tiktok.topPosts[0].id, "tt-a");
  assert.equal(tiktok.bottomPosts[0].id, "tt-c");
  assert.equal(tiktok.lowViewPosts, 2);
  assert.equal(tiktok.undatedSamples, 1);
  assert.ok(tiktok.metricsMissing.includes("reach"), "reach was not collected and must not be reported as 0");
  assert.equal(tiktok.current.reach, undefined);
  assert.equal(tiktok.bestDurations[0].label, "16-30s");
  // YouTube dropped: 100 vs 800
  assert.equal(report.networks.youtube.deltas.views.changePct, -87.5);
  // Missing networks are labeled, never zero-filled
  assert.equal(report.networks.facebook.status, "missing");
  assert.match(report.networks.facebook.missingReason!, /12 publicaciones/);
  assert.equal(report.networks.instagram.status, "missing");
  assert.deepEqual(report.networksMissing, ["facebook", "instagram"]);
  assert.ok(report.recommendations.length >= 3 && report.recommendations.length <= 5);
  assert.match(report.recommendations[0], /YouTube: las vistas bajaron 87[.,]5%/);
  assert.match(report.text, /Instagram: sin datos/);
  // same input, same output
  const again = buildBlackRoomAnalyticsReport({ window: "weekly", now: NOW, samplesByNetwork: { tiktok: source.analyticsImports!.tiktok!.samples as never, youtube: source.analyticsImports!.youtube!.samples as never }, coverage: { networkSamples: { facebook: 12 }, networkErrors: {} } });
  assert.deepEqual(again, report);
});

test("report: daily window compares the last 24h with the 24h before", () => {
  const report = buildBlackRoomAnalyticsReport({
    window: "daily",
    now: NOW,
    samplesByNetwork: { tiktok: [
      { id: "a", views: 10, publishedAt: hoursAgo(2) },
      { id: "b", views: 30, publishedAt: hoursAgo(30) },
      { id: "old", views: 999, publishedAt: hoursAgo(100) },
      { id: "future", views: 999, publishedAt: new Date(NOW.getTime() + 3_600_000).toISOString() },
    ] },
  });
  assert.equal(report.networks.tiktok.current.views, 10);
  assert.equal(report.networks.tiktok.previous.views, 30);
  assert.equal(report.period.start, hoursAgo(24));
});

test("happy path: run stores the report and getStatus reports working with evidence", async () => {
  await withDir(async (dataDir) => {
    let fetchCalls = 0;
    const fetchSpy = (async () => { fetchCalls += 1; throw new Error("no network in tests"); }) as unknown as typeof fetch;
    const agent = createBlackRoomAnalyticsAgent({ readSourceState: async () => sourceState() });
    const ctx = createBlackRoomTeamContext("blackroom-analytics", { env: {}, now: () => NOW, fetch: fetchSpy, dataDir });
    const result = await agent.run(ctx, { window: "weekly" });
    assert.equal(result.ok, true, result.summary);
    assert.match(result.summary, /Sin datos de: Facebook, Instagram/);
    assert.match(result.summary, /Por red: TikTok 2K vistas \(4 posts\)/);
    assert.equal(result.needsApproval, undefined, "analytics never queues outward actions");
    assert.equal(fetchCalls, 0, "no network call without refresh");
    const stored = JSON.parse(await readFile(path.join(dataDir, "blackroom-analytics.json"), "utf8"));
    assert.equal(stored.lastOkAt, NOW.toISOString());
    assert.equal(stored.history.length, 1);

    const status = parseBlackRoomTeamStatus(await agent.getStatus(ctx));
    assert.ok(status);
    assert.equal(status.state, "working");
    assert.equal(status.lastRunAt, NOW.toISOString());
    assert.equal(status.metrics?.redesConDatos, 2);

    // 27h later the evidence is stale: available, not working
    const later = createBlackRoomTeamContext("blackroom-analytics", { env: {}, now: () => new Date(NOW.getTime() + 27 * 3_600_000), fetch: fetchSpy, dataDir });
    assert.equal((await agent.getStatus(later)).state, "available");

    const last = await agent.actions!["last-report"](ctx, {});
    assert.equal(last.ok, true);
    const daily = await agent.actions!["daily-report"](ctx, {});
    assert.equal((daily.report as { window: string }).window, "daily");
  });
});

test("blocked path: no token, no data dir, failing fetch -> blocked with the exact need", async () => {
  await withDir(async (dataDir) => {
    const ctx = createBlackRoomTeamContext("blackroom-analytics", { env: {}, now: () => NOW, fetch: failingFetch, dataDir });
    const status = await defaultAgent.getStatus(ctx);
    assert.equal(status.state, "blocked");
    assert.deepEqual(status.needs, [BLACKROOM_ANALYTICS_TOKEN_NEED]);
    assert.equal(await readdir(dataDir).then((files) => files.length), 0, "getStatus does not write");

    const agent = createBlackRoomAnalyticsAgent({ readSourceState: async () => { throw new Error("DATABASE_URL missing"); } });
    const result = await agent.run(ctx, {});
    assert.equal(result.ok, false);
    assert.equal(result.error, "no_data");
    const after = await agent.getStatus(ctx);
    assert.equal(after.state, "blocked");
    assert.notEqual(after.state, "working");
  });
});

test("token set but no per-post data: run fails honestly and status is blocked, never working", async () => {
  await withDir(async (dataDir) => {
    const agent = createBlackRoomAnalyticsAgent({ readSourceState: async () => ({ analyticsImports: {}, commands: [] }) });
    const ctx = createBlackRoomTeamContext("blackroom-analytics", { env: { METRICOOL_USER_TOKEN: "tok" }, now: () => NOW, fetch: failingFetch, dataDir });
    assert.equal((await agent.getStatus(ctx)).state, "available");
    const result = await agent.run(ctx, {});
    assert.equal(result.ok, false);
    const status = await agent.getStatus(ctx);
    assert.equal(status.state, "blocked");
    assert.match(status.needs[0], /CSV de Metricool/);
  });
});

test("invalid window is refused without touching state", async () => {
  await withDir(async (dataDir) => {
    const agent = createBlackRoomAnalyticsAgent({ readSourceState: async () => sourceState() });
    const ctx = createBlackRoomTeamContext("blackroom-analytics", { env: {}, now: () => NOW, fetch: failingFetch, dataDir });
    const result = await agent.run(ctx, { window: "yearly" });
    assert.equal(result.error, "invalid_window");
    assert.equal((await readdir(dataDir)).length, 0);
  });
});

test("refresh needs the token; with it, the collector only gets a read-only Metricool fetch", async () => {
  await withDir(async (dataDir) => {
    let collectorCalls = 0;
    const agent = createBlackRoomAnalyticsAgent({
      readSourceState: async () => sourceState(),
      collectMetricool: async (options) => {
        collectorCalls += 1;
        await assert.rejects(options.fetch("https://app.metricool.com/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "createScheduledPost", arguments: {} } }) }), /solo lectura/);
        await assert.rejects(options.fetch("https://graph.facebook.com/me/feed", { method: "POST", body: "{}" }), /solo lee Metricool/);
        return { networkSamples: { tiktok: 50, facebook: 20, youtube: 10 }, networkErrors: {}, lastCheckedAt: NOW.toISOString() };
      },
    });
    const noToken = createBlackRoomTeamContext("blackroom-analytics", { env: {}, now: () => NOW, fetch: failingFetch, dataDir });
    const first = await agent.run(noToken, { refresh: true });
    assert.equal(collectorCalls, 0);
    assert.ok((first.report as { limitations: string[] }).limitations.some((line) => /falta METRICOOL_USER_TOKEN/.test(line)));

    const withToken = createBlackRoomTeamContext("blackroom-analytics", { env: { METRICOOL_USER_TOKEN: "tok" }, now: () => NOW, fetch: failingFetch, dataDir });
    const second = await agent.run(withToken, { refresh: true });
    assert.equal(collectorCalls, 1);
    assert.equal((second.report as any).networks.facebook.metricoolPostsSeen, 20);
  });
});

test("read-only fetch guard lets tools/list and get* tools through", async () => {
  const seen: string[] = [];
  const inner = (async (_url: string, init?: RequestInit) => { seen.push(String(init?.body)); return new Response("{}"); }) as unknown as typeof fetch;
  const guarded = createReadOnlyMetricoolFetch(inner);
  await guarded("https://ai.metricool.com/mcp", { method: "POST", body: JSON.stringify({ method: "tools/list" }) });
  await guarded("https://ai.metricool.com/mcp", { method: "POST", body: JSON.stringify({ method: "tools/call", params: { name: "getAnalyticsDataByMetrics" } }) });
  await assert.rejects(guarded("https://ai.metricool.com/mcp", { method: "POST", body: JSON.stringify({ method: "tools/call", params: { name: "post_schedule" } }) }));
  await assert.rejects(guarded("https://ai.metricool.com/mcp", { method: "POST", body: "not json" }));
  assert.equal(seen.length, 2);
});

test("a day without new posts widens to the last 7 days and says when the last post was", async () => {
  await withDir(async (dataDir) => {
    const state = sourceState();
    // Nothing published in the last 24 hours.
    state!.analyticsImports!.tiktok!.samples = (state!.analyticsImports!.tiktok!.samples as Array<Record<string, unknown>>).filter((sample) => sample.id !== "tt-a");
    state!.analyticsImports!.youtube!.samples = (state!.analyticsImports!.youtube!.samples as Array<Record<string, unknown>>).filter((sample) => sample.id !== "yt-a");
    const agent = createBlackRoomAnalyticsAgent({ readSourceState: async () => state });
    const ctx = createBlackRoomTeamContext("blackroom-analytics", { env: {}, now: () => NOW, fetch: failingFetch, dataDir });
    const result = await agent.run(ctx, { window: "daily" });
    assert.equal(result.ok, true);
    assert.match(result.summary, /En las ultimas 24 horas no hubo publicaciones nuevas \(la ultima fue el/);
    assert.match(result.summary, /te muestro los ultimos 7 dias/);
    assert.doesNotMatch(result.summary, /^.*: 0 publicaciones/);
    const report = result.report as { window: string; requestedWindow?: string };
    assert.equal(report.window, "weekly");
    assert.equal(report.requestedWindow, "daily");
  });
});

test("old data is flagged with its date instead of being shown as current", async () => {
  await withDir(async (dataDir) => {
    const later = new Date(NOW.getTime() + 10 * 24 * 60 * 60_000);
    const agent = createBlackRoomAnalyticsAgent({ readSourceState: async () => sourceState() });
    const ctx = createBlackRoomTeamContext("blackroom-analytics", { env: {}, now: () => later, fetch: failingFetch, dataDir });
    const result = await agent.run(ctx, { window: "weekly" });
    assert.equal(result.ok, true);
    assert.match(result.summary, /ultimos 30 dias/);
    assert.match(result.summary, /Ojo: estos numeros son de Metricool al/);
    assert.match(result.summary, /METRICOOL_USER_TOKEN/);
  });
});

test("without per-post detail, Metricool live totals still give a real report; failures say why", async () => {
  await withDir(async (dataDir) => {
    const agent = createBlackRoomAnalyticsAgent({
      readSourceState: async () => ({ analyticsImports: {}, commands: [] }),
      collectMetricool: async () => ({
        networkSamples: { tiktok: 120, youtube: 40, facebook: 0 },
        networkErrors: { facebook: "sin datos" },
        lastCheckedAt: NOW.toISOString(),
        networkMedianViews: { tiktok: 850, youtube: 1300 },
        networkEngagementRate: { tiktok: 0.062 },
        recommendedTimesByNetwork: { tiktok: ["20:00", "22:00"] },
      }),
    });
    const ctx = createBlackRoomTeamContext("blackroom-analytics", { env: { METRICOOL_USER_TOKEN: "tok" }, now: () => NOW, fetch: failingFetch, dataDir });
    const result = await agent.run(ctx, { window: "daily", refresh: true });
    assert.equal(result.ok, true, result.summary);
    assert.match(result.summary, /Metricool en vivo/);
    assert.match(result.summary, /YouTube: 40 posts, mediana 1.3K vistas por post/);
    assert.match(result.summary, /TikTok: 120 posts, mediana 850 vistas por post, engagement 6.2%, mejores horas 20:00 y 22:00/);
    assert.match(result.summary, /Sin datos de: Facebook/);
    const status = await agent.getStatus(ctx);
    assert.equal(status.state, "working");

    const failing = createBlackRoomAnalyticsAgent({
      readSourceState: async () => ({ analyticsImports: {}, commands: [] }),
      collectMetricool: async () => { throw new Error("401 token invalido"); },
    });
    const bad = await failing.run(ctx, { window: "daily", refresh: true });
    assert.equal(bad.ok, false);
    assert.match(bad.summary, /401 token invalido/);
  });
});
