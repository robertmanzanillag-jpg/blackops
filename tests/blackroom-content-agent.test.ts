import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBlackRoomAutopilotPlan,
  buildBlackRoomDownloadJobs,
  buildBlackRoomRenderJobs,
  listBlackRoomYoutubeVideos,
  sanitizeBlackRoomAgentConfig,
  scoreBlackRoomFormats,
  type BlackRoomPerformanceRecord,
  type BlackRoomYoutubeVideo,
} from "../server/blackroom-content-agent.ts";

const video = (id: string, views: number): BlackRoomYoutubeVideo => ({
  id,
  title: `Video ${id}`,
  description: "BlackRoom",
  publishedAt: "2026-07-01T00:00:00Z",
  durationSeconds: 1800,
  viewCount: views,
  likeCount: 10,
  commentCount: 2,
  thumbnailUrl: null,
  watchUrl: `https://www.youtube.com/watch?v=${id}`,
});

const videos = (count: number) => Array.from({ length: count }, (_, index) => video(`source-${index + 1}`, 10_000 - index));

test("sanitizes BlackRoom volume to the requested 5-10 daily range", () => {
  assert.equal(sanitizeBlackRoomAgentConfig({ channelId: "UC1", dailyPostTarget: 99 }).dailyPostTarget, 10);
  assert.equal(sanitizeBlackRoomAgentConfig({ channelId: "UC1", dailyPostTarget: 1 }).dailyPostTarget, 5);
  assert.equal(sanitizeBlackRoomAgentConfig({ channelId: "UC1" }).dailyPostTarget, 5);
  assert.deepEqual(sanitizeBlackRoomAgentConfig({ channelId: "UC1" }).platforms, ["tiktok"]);
  assert.equal(sanitizeBlackRoomAgentConfig({ channelId: "UC1" }).deleteLocalAfterConfirmedUpload, true);
});

test("keeps long-form exploration while allocating more slots to a proven duration", () => {
  const records: BlackRoomPerformanceRecord[] = [];
  for (const durationSeconds of [15, 30, 60, 120, 300, 600] as const) {
    for (let index = 0; index < 12; index += 1) {
      records.push({
        clipId: `${durationSeconds}-${index}`,
        durationSeconds,
        platform: "instagram",
        views: 1000,
        likes: durationSeconds === 300 ? 100 : 10,
        comments: 0,
        shares: 0,
        averageWatchSeconds: durationSeconds === 300 ? 150 : Math.min(durationSeconds, 12),
        completionRate: durationSeconds === 300 ? 0.5 : 0.25,
        publishedAt: "2026-07-01T00:00:00Z",
      });
    }
  }
  const scores = scoreBlackRoomFormats(records, 10, 0.2);
  assert.equal(scores.reduce((sum, score) => sum + score.allocation, 0), 10);
  assert.ok(scores.find((score) => score.durationSeconds === 300)!.score > scores.find((score) => score.durationSeconds === 15)!.score);
  assert.ok(scores.find((score) => score.durationSeconds === 300)!.allocation > 1);
  assert.ok(scores.every((score) => score.allocation >= 1));
});

test("tolerates partial Metricool metrics without poisoning allocations", () => {
  const partial = [{
    clipId: "partial",
    durationSeconds: 30,
    platform: "instagram",
    views: 500,
    publishedAt: "2026-07-01T00:00:00Z",
  }] as BlackRoomPerformanceRecord[];
  const scores = scoreBlackRoomFormats(partial, 8, 0.25);
  assert.equal(scores.reduce((sum, score) => sum + score.allocation, 0), 8);
  assert.ok(scores.every((score) => Number.isFinite(score.score)));
});

test("never abandons a long-form variant in a ten-post experiment", () => {
  const records: BlackRoomPerformanceRecord[] = [];
  for (const durationSeconds of [15, 30, 60, 120, 300, 600] as const) {
    for (let index = 0; index < 12; index += 1) {
      records.push({
        clipId: `extreme-${durationSeconds}-${index}`,
        durationSeconds,
        platform: "tiktok",
        views: 1000,
        likes: durationSeconds === 15 ? 500 : 0,
        comments: 0,
        shares: 0,
        averageWatchSeconds: durationSeconds === 15 ? 15 : 1,
        completionRate: durationSeconds === 15 ? 1 : 0,
        publishedAt: "2026-07-01T00:00:00Z",
      });
    }
  }
  const scores = scoreBlackRoomFormats(records, 10, 0.15);
  assert.equal(scores.reduce((sum, score) => sum + score.allocation, 0), 10);
  assert.ok(scores.every((score) => score.allocation >= 1));
  assert.ok(scores.find((score) => score.durationSeconds === 15)!.allocation > 1);
});

test("builds maximum-quality yt-dlp jobs without playlist expansion", () => {
  const jobs = buildBlackRoomDownloadJobs([video("abc", 100)], "/tmp/blackroom");
  assert.equal(jobs.length, 1);
  assert.match(jobs[0].outputTemplate, /abc/);
  assert.ok(jobs[0].commands.some((command) => command.args.includes("--no-playlist")));
  assert.ok(jobs[0].commands.some((command) => command.args.includes("--merge-output-format")));
  assert.ok(jobs[0].commands.some((command) => command.args.some((arg) => arg.includes("bv*") || arg.includes("bestvideo"))));
});

test("creates an approval-only daily Metricool experiment plan", () => {
  const plan = buildBlackRoomAutopilotPlan({
    config: { channelId: "UC1", dailyPostTarget: 8, platforms: ["instagram", "tiktok", "youtube"] },
    videos: videos(8),
    performance: [],
    startAt: new Date("2026-07-20T12:00:00Z"),
  });
  assert.equal(plan.metricoolDrafts.length, 8);
  assert.equal(plan.realPublishEnabled, false);
  assert.equal(plan.localCleanup.trigger, "metricool_upload_confirmed");
  assert.equal(plan.localCleanup.keepFailedUploadsForRetry, true);
  assert.ok(plan.metricoolDrafts.every((draft) => draft.status === "approval_required"));
  assert.deepEqual(new Set(plan.metricoolDrafts.map((draft) => draft.durationSeconds)), new Set([15, 30, 60, 120, 300, 600]));
  assert.ok(plan.metricoolDrafts.filter((draft) => draft.durationSeconds >= 300).every((draft) => draft.videoFormat === "horizontal"));
  assert.equal(plan.renderJobs.length, 8);
});

test("targets only TikTok when no platform override is provided", () => {
  const plan = buildBlackRoomAutopilotPlan({
    config: { channelId: "UC1", dailyPostTarget: 5 },
    videos: videos(5),
    performance: [],
    startAt: new Date("2026-07-20T12:00:00Z"),
  });
  assert.equal(plan.metricoolDrafts.length, 5);
  assert.ok(plan.metricoolDrafts.every((draft) => draft.platform === "tiktok"));
});

test("builds paired vertical and horizontal ffmpeg edit jobs", () => {
  const plan = buildBlackRoomAutopilotPlan({
    config: { channelId: "UC1", dailyPostTarget: 5 },
    videos: videos(5),
    performance: [],
    startAt: new Date("2026-07-20T12:00:00Z"),
  });
  const jobs = buildBlackRoomRenderJobs({
    drafts: plan.metricoolDrafts,
    videos: videos(5),
    sourceDirectory: "/sources",
    outputDirectory: "/rendered",
  });
  assert.equal(jobs.length, 5);
  assert.ok(jobs.every((job) => job.command.command === "ffmpeg"));
  assert.ok(jobs.some((job) => job.videoFormat === "vertical" && job.command.args.some((arg) => arg.includes("crop=1080:1920"))));
  assert.ok(jobs.some((job) => job.videoFormat === "horizontal" && job.command.args.some((arg) => arg.includes("pad=1920:1080"))));
  assert.ok(jobs.every((job) => job.startSeconds + job.durationSeconds <= 1800));
  assert.ok(jobs.every((job) => job.command.args.includes("-maxrate") && job.command.args.includes("5M")));
  assert.ok(jobs.every((job) => job.command.args.includes("128k")));
});

test("does not assign a long-form draft to a source that is too short", () => {
  const sourceVideos = videos(10).map((item, index) => ({ ...item, durationSeconds: index === 9 ? 900 : 90 }));
  const plan = buildBlackRoomAutopilotPlan({
    config: { channelId: "UC1", dailyPostTarget: 10 },
    videos: sourceVideos,
    performance: [],
    startAt: new Date("2026-07-20T12:00:00Z"),
  });
  assert.equal(plan.metricoolDrafts.length, 10);
  assert.ok(plan.metricoolDrafts.every((draft) => sourceVideos.find((item) => item.id === draft.sourceVideoId)!.durationSeconds >= draft.durationSeconds));
  assert.equal(new Set(plan.metricoolDrafts.map((draft) => draft.sourceVideoId)).size, plan.metricoolDrafts.length);
});

test("uses controlled random order without repeating source videos", () => {
  const sourceVideos = videos(8);
  const input = {
    config: { channelId: "UC1", dailyPostTarget: 6, selectionSeed: "pilot-seed" },
    videos: sourceVideos,
    performance: [],
    startAt: new Date("2026-07-20T12:00:00Z"),
  };
  const first = buildBlackRoomAutopilotPlan(input);
  const second = buildBlackRoomAutopilotPlan(input);
  assert.deepEqual(first.metricoolDrafts, second.metricoolDrafts);
  assert.equal(new Set(first.metricoolDrafts.map((draft) => draft.sourceVideoId)).size, first.metricoolDrafts.length);
  assert.deepEqual(first.metricoolDrafts.map((draft) => draft.videoFormat), ["vertical", "horizontal", "vertical", "horizontal", "horizontal", "horizontal"]);
  assert.ok(first.metricoolDrafts.every((draft) => draft.experimentKey.includes("selection:controlled-random")));
});

test("excludes every source video already used by the persistent agent", () => {
  const plan = buildBlackRoomAutopilotPlan({
    config: { channelId: "UC1", dailyPostTarget: 5 },
    videos: videos(7),
    usedSourceVideoIds: ["source-1", "source-2"],
    performance: [],
    startAt: new Date("2026-07-20T12:00:00Z"),
  });
  assert.equal(plan.metricoolDrafts.length, 5);
  assert.ok(plan.metricoolDrafts.every((draft) => !["source-1", "source-2"].includes(draft.sourceVideoId)));
});

test("paginates the uploads playlist and enriches video statistics", async () => {
  const calls: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const parsed = new URL(url);
    let body: any;
    if (parsed.pathname.endsWith("/channels")) body = { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] };
    else if (parsed.pathname.endsWith("/playlistItems") && !parsed.searchParams.get("pageToken")) body = { items: [{ contentDetails: { videoId: "a" } }], nextPageToken: "next" };
    else if (parsed.pathname.endsWith("/playlistItems")) body = { items: [{ contentDetails: { videoId: "b" } }] };
    else body = { items: [
      { id: "a", snippet: { title: "A", publishedAt: "2026-01-01", thumbnails: {} }, contentDetails: { duration: "PT1M30S" }, statistics: { viewCount: "10" }, status: { privacyStatus: "public" } },
      { id: "b", snippet: { title: "B", publishedAt: "2026-01-02", thumbnails: {} }, contentDetails: { duration: "PT2M" }, statistics: { viewCount: "20" }, status: { privacyStatus: "public" } },
    ] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const videos = await listBlackRoomYoutubeVideos({ channelId: "UC1", apiKey: "key", fetcher });
  assert.equal(videos.length, 2);
  assert.equal(videos[0].id, "b");
  assert.equal(videos[0].durationSeconds, 120);
  assert.equal(calls.filter((url) => url.includes("playlistItems")).length, 2);
});
