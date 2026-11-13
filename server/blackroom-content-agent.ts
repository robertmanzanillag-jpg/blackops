import { buildYtDlpCommandSpecs, type YtDlpCommandSpec } from "./youtube-downloader.ts";

export const BLACKROOM_DURATION_VARIANTS = [15, 30, 60, 120, 300, 600] as const;
export const BLACKROOM_SOURCE_DIRECTORY = "clippers_workspace/blackroom/sources";
export const BLACKROOM_RENDER_DIRECTORY = "clippers_workspace/blackroom/rendered";

export type BlackRoomDuration = (typeof BLACKROOM_DURATION_VARIANTS)[number];
export type BlackRoomPlatform = "instagram" | "tiktok" | "youtube";
export type BlackRoomVideoFormat = "vertical" | "horizontal";

export interface BlackRoomAgentConfig {
  channelId: string;
  dailyPostTarget: number;
  platforms: BlackRoomPlatform[];
  timezone: string;
  explorationShare: number;
  selectionSeed: string;
  deleteLocalAfterConfirmedUpload: boolean;
  publishMode: "approval_required" | "live";
}

export interface BlackRoomYoutubeVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  thumbnailUrl: string | null;
  watchUrl: string;
}

export interface BlackRoomPerformanceRecord {
  clipId: string;
  durationSeconds: BlackRoomDuration;
  platform: BlackRoomPlatform;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  averageWatchSeconds?: number;
  completionRate?: number;
  profileVisits?: number;
  followersGained?: number;
  publishedAt: string;
}

export interface BlackRoomFormatScore {
  durationSeconds: BlackRoomDuration;
  samples: number;
  score: number;
  averageRetention: number;
  averageEngagement: number;
  averageWatchSeconds: number;
  averageGrowthRate: number;
  allocation: number;
  reason: string;
}

export interface BlackRoomDownloadJob {
  videoId: string;
  sourceUrl: string;
  outputTemplate: string;
  commands: YtDlpCommandSpec[];
}

export interface BlackRoomMetricoolDraft {
  id: string;
  sourceVideoId: string;
  durationSeconds: BlackRoomDuration;
  platform: BlackRoomPlatform;
  videoFormat: BlackRoomVideoFormat;
  scheduledAt: string;
  status: "approval_required";
  experimentKey: string;
}

export interface BlackRoomRenderJob {
  id: string;
  sourceVideoId: string;
  inputPath: string;
  outputPath: string;
  startSeconds: number;
  durationSeconds: BlackRoomDuration;
  videoFormat: BlackRoomVideoFormat;
  command: YtDlpCommandSpec;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback;
}

export function sanitizeBlackRoomAgentConfig(input: Partial<BlackRoomAgentConfig>): BlackRoomAgentConfig {
  const platforms = Array.from(new Set((input.platforms || ["tiktok"])
    .filter((platform): platform is BlackRoomPlatform => ["instagram", "tiktok", "youtube"].includes(platform))));

  return {
    channelId: String(input.channelId || "").trim(),
    dailyPostTarget: clampInteger(input.dailyPostTarget, 5, 10, 5),
    platforms: platforms.length ? platforms : ["tiktok"],
    timezone: String(input.timezone || "America/New_York").trim() || "America/New_York",
    explorationShare: Math.min(0.5, Math.max(0.15, Number(input.explorationShare) || 0.25)),
    selectionSeed: String(input.selectionSeed || "blackroom-controlled-random").trim() || "blackroom-controlled-random",
    deleteLocalAfterConfirmedUpload: input.deleteLocalAfterConfirmedUpload !== false,
    // The first production gate is intentionally reviewable. Live publishing can only be
    // enabled by the external Metricool executor after its own credential/approval checks.
    publishMode: input.publishMode === "live" ? "live" : "approval_required",
  };
}

function parseIsoDurationSeconds(value: string): number {
  const match = String(value || "").match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!match) return 0;
  return Math.round(
    Number(match[1] || 0) * 86400
    + Number(match[2] || 0) * 3600
    + Number(match[3] || 0) * 60
    + Number(match[4] || 0),
  );
}

function asCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function youtubeJson(fetcher: FetchLike, pathname: string, params: URLSearchParams): Promise<any> {
  const response = await fetcher(`https://www.googleapis.com/youtube/v3/${pathname}?${params.toString()}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`YouTube Data API: ${detail}`);
  }
  return payload;
}

export async function listBlackRoomYoutubeVideos(input: {
  channelId: string;
  apiKey: string;
  fetcher?: FetchLike;
}): Promise<BlackRoomYoutubeVideo[]> {
  const channelId = input.channelId.trim();
  const apiKey = input.apiKey.trim();
  if (!channelId) throw new Error("BLACKROOM_YOUTUBE_CHANNEL_ID is required.");
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is required to inventory the BlackRoom channel.");
  const fetcher = input.fetcher || fetch;

  const channelPayload = await youtubeJson(fetcher, "channels", new URLSearchParams({
    part: "contentDetails",
    id: channelId,
    key: apiKey,
  }));
  const uploadsPlaylistId = channelPayload?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) throw new Error(`YouTube channel ${channelId} was not found or has no uploads playlist.`);

  const videoIds: string[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      part: "contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: "50",
      key: apiKey,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await youtubeJson(fetcher, "playlistItems", params);
    for (const item of page?.items || []) {
      const id = String(item?.contentDetails?.videoId || "").trim();
      if (id) videoIds.push(id);
    }
    pageToken = String(page?.nextPageToken || "");
  } while (pageToken);

  const videos: BlackRoomYoutubeVideo[] = [];
  for (let offset = 0; offset < videoIds.length; offset += 50) {
    const ids = videoIds.slice(offset, offset + 50);
    const page = await youtubeJson(fetcher, "videos", new URLSearchParams({
      part: "snippet,contentDetails,statistics,status",
      id: ids.join(","),
      key: apiKey,
    }));
    for (const item of page?.items || []) {
      if (item?.status?.privacyStatus === "private") continue;
      const snippet = item?.snippet || {};
      const statistics = item?.statistics || {};
      const thumbnailUrl = snippet?.thumbnails?.maxres?.url
        || snippet?.thumbnails?.standard?.url
        || snippet?.thumbnails?.high?.url
        || null;
      videos.push({
        id: String(item.id),
        title: String(snippet.title || "Untitled"),
        description: String(snippet.description || ""),
        publishedAt: String(snippet.publishedAt || ""),
        durationSeconds: parseIsoDurationSeconds(item?.contentDetails?.duration || ""),
        viewCount: asCount(statistics.viewCount),
        likeCount: asCount(statistics.likeCount),
        commentCount: asCount(statistics.commentCount),
        thumbnailUrl,
        watchUrl: `https://www.youtube.com/watch?v=${item.id}`,
      });
    }
  }

  return videos.sort((left, right) => right.viewCount - left.viewCount || right.publishedAt.localeCompare(left.publishedAt));
}

export function buildBlackRoomDownloadJobs(videos: BlackRoomYoutubeVideo[], outputDirectory: string): BlackRoomDownloadJob[] {
  return videos.map((video) => {
    const outputTemplate = `${outputDirectory.replace(/\/$/, "")}/${video.id}.%(ext)s`;
    return {
      videoId: video.id,
      sourceUrl: video.watchUrl,
      outputTemplate,
      commands: buildYtDlpCommandSpecs({
        url: video.watchUrl,
        outputTemplate,
        mode: "video",
        explicitBinary: process.env.YT_DLP_PATH,
      }),
    };
  });
}

function recordRetention(record: BlackRoomPerformanceRecord): number {
  const duration = asCount(record.durationSeconds);
  if (Number.isFinite(Number(record.completionRate))) return Math.min(1, Math.max(0, Number(record.completionRate)));
  if (duration > 0 && Number.isFinite(Number(record.averageWatchSeconds))) {
    return Math.min(1, Math.max(0, Number(record.averageWatchSeconds) / duration));
  }
  return 0;
}

function recordEngagement(record: BlackRoomPerformanceRecord): number {
  const views = asCount(record.views);
  if (!views) return 0;
  return (asCount(record.likes) + asCount(record.comments) * 2 + asCount(record.shares) * 3) / views;
}

function recordAverageWatchSeconds(record: BlackRoomPerformanceRecord): number {
  if (Number.isFinite(Number(record.averageWatchSeconds))) return asCount(record.averageWatchSeconds);
  if (Number.isFinite(Number(record.completionRate))) return asCount(record.durationSeconds) * recordRetention(record);
  return 0;
}

function recordGrowthRate(record: BlackRoomPerformanceRecord): number {
  const views = asCount(record.views);
  if (!views) return 0;
  return (asCount(record.profileVisits) + asCount(record.followersGained) * 5) / views;
}

function distributeSlots(weights: number[], total: number): number[] {
  const raw = weights.map((weight) => weight * total);
  const slots = raw.map(Math.floor);
  let remaining = total - slots.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, remainder: value - slots[index] }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) slots[order[index % order.length].index] += 1;
  return slots;
}

export function scoreBlackRoomFormats(
  records: BlackRoomPerformanceRecord[],
  dailyPostTarget = 5,
  explorationShare = 0.25,
): BlackRoomFormatScore[] {
  const target = clampInteger(dailyPostTarget, 5, 10, 5);
  const exploration = Math.min(0.5, Math.max(0.15, explorationShare));
  const aggregates = BLACKROOM_DURATION_VARIANTS.map((durationSeconds) => {
    const matches = records.filter((record) => Number(record?.durationSeconds) === durationSeconds && asCount(record?.views) >= 0);
    const averageRetention = matches.length ? matches.reduce((sum, record) => sum + recordRetention(record), 0) / matches.length : 0;
    const averageEngagement = matches.length ? matches.reduce((sum, record) => sum + recordEngagement(record), 0) / matches.length : 0;
    const averageWatchSeconds = matches.length ? matches.reduce((sum, record) => sum + recordAverageWatchSeconds(record), 0) / matches.length : 0;
    const averageGrowthRate = matches.length ? matches.reduce((sum, record) => sum + recordGrowthRate(record), 0) / matches.length : 0;
    const confidence = Math.min(1, matches.length / 12);
    // Completion alone unfairly favors short clips. Watch time uses a logarithmic
    // curve so long videos receive credit for sustained viewing without dominating.
    const watchTimeScore = Math.min(1, Math.log2(1 + averageWatchSeconds) / Math.log2(121));
    const observedScore = averageRetention * 0.4
      + watchTimeScore * 0.35
      + Math.min(1, averageEngagement * 20) * 0.15
      + Math.min(1, averageGrowthRate * 50) * 0.1;
    const priorScore = 0.45;
    const score = observedScore * confidence + priorScore * (1 - confidence);
    return { durationSeconds, samples: matches.length, score, averageRetention, averageEngagement, averageWatchSeconds, averageGrowthRate };
  });
  const totalScore = aggregates.reduce((sum, item) => sum + Math.max(0.01, item.score), 0);
  const equalWeight = 1 / aggregates.length;
  const weights = aggregates.map((item) => exploration * equalWeight + (1 - exploration) * (Math.max(0.01, item.score) / totalScore));
  const allocations = target >= aggregates.length
    ? distributeSlots(weights, target - aggregates.length).map((allocation) => allocation + 1)
    : distributeSlots(weights, target);

  return aggregates.map((item, index) => ({
    ...item,
    score: Number(item.score.toFixed(4)),
    averageRetention: Number(item.averageRetention.toFixed(4)),
    averageEngagement: Number(item.averageEngagement.toFixed(4)),
    averageWatchSeconds: Number(item.averageWatchSeconds.toFixed(2)),
    averageGrowthRate: Number(item.averageGrowthRate.toFixed(4)),
    allocation: allocations[index],
    reason: item.samples < 6
      ? "Exploración: todavía faltan muestras para decidir un ganador."
      : `Optimización: ${item.averageWatchSeconds.toFixed(1)}s vistos, retención ${(item.averageRetention * 100).toFixed(1)}%, engagement ${(item.averageEngagement * 100).toFixed(2)}% y crecimiento ${(item.averageGrowthRate * 100).toFixed(2)}%.`,
  }));
}

export function buildBlackRoomMetricoolDrafts(input: {
  videos: BlackRoomYoutubeVideo[];
  usedSourceVideoIds?: string[];
  scores: BlackRoomFormatScore[];
  platforms: BlackRoomPlatform[];
  startAt: Date;
  selectionSeed?: string;
}): BlackRoomMetricoolDraft[] {
  const usedSourceVideoIds = new Set(input.usedSourceVideoIds || []);
  const availableVideos = input.videos.filter((video) => !usedSourceVideoIds.has(video.id));
  if (!availableVideos.length) return [];
  const remaining = new Map(input.scores.map((score) => [score.durationSeconds, score.allocation]));
  const durations: BlackRoomDuration[] = [];
  while (durations.length < input.scores.reduce((sum, score) => sum + score.allocation, 0)) {
    for (const score of input.scores) {
      const count = remaining.get(score.durationSeconds) || 0;
      if (count > 0) {
        durations.push(score.durationSeconds);
        remaining.set(score.durationSeconds, count - 1);
      }
    }
  }
  const randomizedVideos = deterministicShuffle(
    availableVideos,
    `${input.selectionSeed || "blackroom-controlled-random"}|${input.startAt.toISOString().slice(0, 10)}`,
  );
  const drafts: BlackRoomMetricoolDraft[] = [];
  const remainingVideos = [...randomizedVideos];
  const addDraft = (durationSeconds: BlackRoomDuration, video: BlackRoomYoutubeVideo) => {
    const slot = drafts.length;
    const videoFormat: BlackRoomVideoFormat = durationSeconds >= 300
      ? "horizontal"
      : slot % 2 === 0 ? "vertical" : "horizontal";
    const platform = input.platforms[slot % input.platforms.length];
    const scheduledAt = new Date(input.startAt.getTime() + slot * 90 * 60 * 1000);
    drafts.push({
      id: `blackroom-${video.id}-${durationSeconds}-${videoFormat}-${slot + 1}`,
      sourceVideoId: video.id,
      durationSeconds,
      platform,
      videoFormat,
      scheduledAt: scheduledAt.toISOString(),
      status: "approval_required",
      experimentKey: `duration:${durationSeconds}|format:${videoFormat}|platform:${platform}|selection:controlled-random`,
    });
  };
  durations.forEach((durationSeconds) => {
    const compatibleIndex = remainingVideos.findIndex((video) => video.durationSeconds >= durationSeconds);
    if (compatibleIndex < 0) return;
    const [video] = remainingVideos.splice(compatibleIndex, 1);
    addDraft(durationSeconds, video);
  });
  const rankedDurations = [...input.scores].sort((left, right) => right.score - left.score || left.durationSeconds - right.durationSeconds);
  while (drafts.length < durations.length && remainingVideos.length) {
    const video = remainingVideos.shift()!;
    const fallback = rankedDurations.find((score) => score.durationSeconds <= video.durationSeconds);
    if (fallback) addDraft(fallback.durationSeconds, video);
  }
  return drafts;
}

function stableHash(seed: string): number {
  let hash = 0;
  for (const character of seed) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return hash;
}

function deterministicShuffle<T>(values: T[], seed: string): T[] {
  return values
    .map((value, index) => ({ value, index, rank: stableHash(`${seed}|${index}`) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((item) => item.value);
}

function stableOffset(seed: string, availableSeconds: number): number {
  return availableSeconds > 0 ? stableHash(seed) % (availableSeconds + 1) : 0;
}

export function buildBlackRoomRenderJobs(input: {
  drafts: BlackRoomMetricoolDraft[];
  videos: BlackRoomYoutubeVideo[];
  sourceDirectory: string;
  outputDirectory: string;
}): BlackRoomRenderJob[] {
  const videosById = new Map(input.videos.map((video) => [video.id, video]));
  return input.drafts.flatMap((draft) => {
    const video = videosById.get(draft.sourceVideoId);
    if (!video || video.durationSeconds < draft.durationSeconds) return [];
    const startSeconds = stableOffset(draft.id, Math.max(0, video.durationSeconds - draft.durationSeconds));
    const inputPath = `${input.sourceDirectory.replace(/\/$/, "")}/${video.id}.mp4`;
    const outputPath = `${input.outputDirectory.replace(/\/$/, "")}/${draft.id}.mp4`;
    return [{
      id: draft.id,
      sourceVideoId: video.id,
      inputPath,
      outputPath,
      startSeconds,
      durationSeconds: draft.durationSeconds,
      videoFormat: draft.videoFormat,
      command: {
        command: "ffmpeg",
        args: [
          "-y",
          "-ss", String(startSeconds),
          "-i", inputPath,
          "-t", String(draft.durationSeconds),
          "-vf", draft.videoFormat === "vertical"
            ? "split=2[base][fg];[base]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:10[bg];[fg]scale=1080:-2[front];[bg][front]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30"
            : "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30",
          "-c:v", "libx264",
          "-preset", "medium",
          "-crf", "20",
          "-maxrate", "5M",
          "-bufsize", "10M",
          "-c:a", "aac",
          "-b:a", "128k",
          "-movflags", "+faststart",
          outputPath,
        ],
      },
    }];
  });
}

export function buildBlackRoomAutopilotPlan(input: {
  config: Partial<BlackRoomAgentConfig>;
  videos: BlackRoomYoutubeVideo[];
  performance: BlackRoomPerformanceRecord[];
  usedSourceVideoIds?: string[];
  startAt?: Date;
}) {
  const config = sanitizeBlackRoomAgentConfig(input.config);
  const scores = scoreBlackRoomFormats(input.performance, config.dailyPostTarget, config.explorationShare);
  const drafts = buildBlackRoomMetricoolDrafts({
    videos: input.videos,
    usedSourceVideoIds: input.usedSourceVideoIds,
    scores,
    platforms: config.platforms,
    startAt: input.startAt || new Date(),
    selectionSeed: config.selectionSeed,
  });
  return {
    generatedAt: new Date().toISOString(),
    config: { ...config, publishMode: "approval_required" as const },
    inventory: {
      videos: input.videos.length,
      totalViews: input.videos.reduce((sum, video) => sum + video.viewCount, 0),
      sourceVideoIds: input.videos.map((video) => video.id),
    },
    formatScores: scores,
    metricoolDrafts: drafts,
    renderJobs: buildBlackRoomRenderJobs({
      drafts,
      videos: input.videos,
      sourceDirectory: BLACKROOM_SOURCE_DIRECTORY,
      outputDirectory: BLACKROOM_RENDER_DIRECTORY,
    }),
    localCleanup: {
      enabled: config.deleteLocalAfterConfirmedUpload,
      trigger: "metricool_upload_confirmed" as const,
      keepFailedUploadsForRetry: true,
      deleteRenderedVideoAfterConfirmation: config.deleteLocalAfterConfirmedUpload,
      deleteSourceOnlyAfterEveryVariantIsConfirmed: config.deleteLocalAfterConfirmedUpload,
    },
    realPublishEnabled: false,
    nextStep: drafts.length
      ? "Render unique source videos, review the first batch, then send approved media to the Metricool executor."
      : "Connect the BlackRoom YouTube channel and sync its upload inventory.",
  };
}
