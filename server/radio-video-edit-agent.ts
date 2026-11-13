import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { storage } from "./storage";
import { createPendingActionForApproval, writeAuditLog } from "./trust-policy";
import { sendPushNotification } from "./push-notifications";
import { sendTelegramPlainMessage } from "./telegram";
import {
  DRIVE_APP_ROOT_FOLDER,
  DRIVE_BLACK_ROOM_VIDEOS_FOLDER,
  ensureAppDriveFolderPath,
  ensureDriveFolderPath,
  ensureDriveFolderPathUnderParent,
  findDriveFolderPath,
  findDriveFolderPathUnderParent,
  getConfiguredClippersDriveRootFolderId,
  searchDriveFoldersByName,
  downloadDriveFileToPath,
  uploadLocalFileToDriveFolder,
} from "./google-drive";
import { hasRealValue } from "./ceo-doctor-cli";
import { buildYtDlpCommandSpecs, formatYtDlpFailureMessage, type YtDlpCommandSpec } from "./youtube-downloader";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);
const AUDIO_EXTENSIONS = new Set([".aac", ".m4a", ".mp3", ".mp4", ".ogg", ".opus", ".wav", ".webm"]);
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "radio_video_edits", "03_listos_para_subir");
const DEFAULT_FALLBACK_INPUT_DIR = path.join(process.cwd(), "radio_video_edits", "01_originales");
const IG_RADIO_FOLDER_NAME = "Instagram";
const TIKTOK_RADIO_FOLDER_NAME = "TikTok";
const DEFAULT_INSTAGRAM_CLIP_COUNT = 1;
const DEFAULT_TIKTOK_CLIP_COUNT = 1;
const MAX_CLIPS_PER_PLATFORM = 10;

function getTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return hasRealValue(token) ? token : null;
}

type RadioEditStatus = "queued" | "analyzing" | "needs_dj_name" | "rendering" | "completed" | "failed";

type CommandResult = {
  stdout: string;
  stderr: string;
};

type RadioVideoJobInput = {
  videoPath: string;
  outputDir?: string;
  sourceDir?: string;
  fallbackInputDir?: string;
  bestDropSecond?: number;
  bestDropSeconds?: number[];
  djName?: string;
  userId?: string;
  driveFolderId?: string;
  driveFolderName?: string;
  driveFolderPath?: string[];
  driveParentFolderId?: string;
  musicPath?: string;
  musicUrl?: string;
  instagramClipCount?: number;
  tiktokClipCount?: number;
  deleteSourceAfterSuccess?: boolean;
};

type RenderedClip = {
  kind: "horizontal_ig" | "vertical_tiktok";
  path: string;
  driveFolderName?: string;
  driveFileId?: string;
  driveWebViewLink?: string | null;
  durationSeconds: number;
  width: number;
  height: number;
  audioSource?: "source_drop" | "music_drop" | "original";
  musicDropSecond?: number;
  clipNumber?: number;
  startSecond?: number;
};

export type RadioVideoProcessResult = {
  videoPath: string;
  status: RadioEditStatus;
  djName?: string;
  pendingActionId?: string;
  clips?: RenderedClip[];
  error?: string;
  sourceVideoDeleted?: boolean;
  sourceVideoDeletedPath?: string;
  sourceVideoCleanupError?: string;
};

export type RadioYoutubeProcessResult = RadioVideoProcessResult & {
  youtubeUrl: string;
  driveFolderPath?: string[];
  driveFolderId?: string;
  driveFolderCreated?: boolean;
  musicUrl?: string;
  musicPath?: string;
  pendingActionId?: string;
};

export type RadioDriveVideoProcessResult = RadioVideoProcessResult & {
  sourceDriveFileId: string;
  sourceDriveUrl?: string;
  sourceDriveFileName?: string;
  driveFolderPath?: string[];
  driveFolderId?: string;
  driveFolderCreated?: boolean;
  musicUrl?: string;
  musicPath?: string;
  pendingActionId?: string;
};

function runCommand(command: string, args: string[], options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    let stdout = "";
    let stderr = "";
    let didTimeout = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          didTimeout = true;
          child.kill("SIGKILL");
        }, options.timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (didTimeout) {
        reject(new Error(`${command} timed out`));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} failed with code ${code}: ${stderr || stdout}`));
    });
  });
}

let freshYtDlpPythonPackageDirPromise: Promise<string | null> | null = null;

function shouldAutoInstallFreshYtDlp(): boolean {
  const configured = process.env.YT_DLP_AUTO_UPDATE?.trim();
  return !/^(0|false|off|none|disabled)$/i.test(configured || "");
}

function pythonEnvForYtDlpPackageDir(packageDir: string): NodeJS.ProcessEnv {
  const currentPythonPath = process.env.PYTHONPATH?.trim();
  return {
    ...process.env,
    PYTHONPATH: currentPythonPath ? `${packageDir}${path.delimiter}${currentPythonPath}` : packageDir,
  };
}

function pipInstallEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PIP_CONFIG_FILE: process.platform === "win32" ? "NUL" : "/dev/null",
    PIP_USER: "false",
    PYTHONNOUSERSITE: "1",
  };
}

async function packageSupportsYtDlpJsRuntimes(packageDir: string): Promise<boolean> {
  try {
    await runCommand("python3", [
      "-m",
      "yt_dlp",
      "--js-runtimes",
      "node",
      "--version",
    ], {
      timeoutMs: 15_000,
      env: pythonEnvForYtDlpPackageDir(packageDir),
    });
    return true;
  } catch {
    return false;
  }
}

async function existingFreshYtDlpPackageDir(packageDir: string): Promise<string | null> {
  const packageMarker = path.join(packageDir, "yt_dlp", "__init__.py");
  if (!(await pathExists(packageMarker))) return null;
  return (await packageSupportsYtDlpJsRuntimes(packageDir)) ? packageDir : null;
}

async function ensureFreshYtDlpPythonPackageDir(): Promise<string | null> {
  if (!shouldAutoInstallFreshYtDlp()) return null;

  const bundledDir = process.env.YT_DLP_BUNDLED_PYTHON_DIR?.trim()
    || path.join(process.cwd(), "dist", "yt-dlp-python");
  const existingBundledDir = await existingFreshYtDlpPackageDir(bundledDir);
  if (existingBundledDir) return existingBundledDir;

  const targetDir = process.env.YT_DLP_PYTHON_TARGET_DIR?.trim()
    || path.join(os.tmpdir(), "robplanner-yt-dlp-python");
  const existingTargetDir = await existingFreshYtDlpPackageDir(targetDir);
  if (existingTargetDir) return existingTargetDir;

  await fs.mkdir(targetDir, { recursive: true });
  try {
    await runCommand("python3", [
      "-m",
      "pip",
      "install",
      "--upgrade",
      "--force-reinstall",
      "--target",
      targetDir,
      "yt-dlp[default]",
      "curl-cffi>=0.11",
    ], { timeoutMs: 5 * 60 * 1000, env: pipInstallEnv() });
    return (await existingFreshYtDlpPackageDir(targetDir)) || targetDir;
  } catch (error) {
    console.warn("[radio-video-edit] could not install fresh yt-dlp:", error instanceof Error ? error.message : error);
    return null;
  }
}

function getFreshYtDlpPythonPackageDir(): Promise<string | null> {
  freshYtDlpPythonPackageDirPromise ||= ensureFreshYtDlpPythonPackageDir();
  return freshYtDlpPythonPackageDirPromise;
}

function sanitizeDjName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function cleanOcrName(value: string): string | null {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = lines
    .map((line) => line.replace(/[^a-zA-Z0-9 ._-]/g, " ").replace(/\s+/g, " ").trim())
    .map((line) => line.replace(/\b(BR|DJ|RADIO|BLACK|ROOM|MIAMI)\b/gi, "").trim())
    .map(sanitizeDjName)
    .filter((line) => /^[A-Z0-9_]{2,24}$/.test(line));

  return candidates[0] || null;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeClipCount(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(MAX_CLIPS_PER_PLATFORM, Math.floor(parsed)));
}

function uniqueDropSeconds(values: number[], duration: number): number[] {
  const result: number[] = [];
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const clamped = Math.max(0, Math.min(duration, value));
    if (result.some((existing) => Math.abs(existing - clamped) < 2)) continue;
    result.push(clamped);
  }
  return result;
}

function evenlyDistributedDropSeconds(duration: number, count: number): number[] {
  const normalizedCount = normalizeClipCount(count, 1);
  if (normalizedCount === 1) return [duration / 2];
  return Array.from({ length: normalizedCount }, (_, index) => (
    Math.min(duration, Math.max(0, ((index + 1) / (normalizedCount + 1)) * duration))
  ));
}

function splitDriveFolderPath(value: string): string[] {
  return value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function sanitizeDownloadedVideoName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "radio_youtube_video";
}

function folderNameFromDownloadedYoutubeVideo(videoPath: string): string {
  const parsed = path.parse(videoPath);
  const cleaned = parsed.name
    .replace(/-[a-zA-Z0-9_-]{8,16}$/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 120) || "YouTube video clips";
}

function isYouTubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
  } catch {
    return false;
  }
}

async function runFirstSuccessfulCommand(commandSpecs: YtDlpCommandSpec[], timeoutMs: number, mediaLabel: "video" | "audio" = "video"): Promise<void> {
  const errors: string[] = [];
  for (const spec of commandSpecs) {
    try {
      await runCommand(spec.command, spec.args, { timeoutMs, env: spec.env });
      return;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(formatYtDlpFailureMessage(errors.join("\n"), mediaLabel));
}

async function downloadYoutubeVideo(url: string, outputDir: string): Promise<string> {
  if (!isYouTubeUrl(url)) {
    throw new Error("El link no parece ser de YouTube.");
  }

  await fs.mkdir(outputDir, { recursive: true });
  const outputTemplate = path.join(outputDir, "%(title).120s-%(id)s.%(ext)s");
  const freshPythonPackageDir = await getFreshYtDlpPythonPackageDir();
  const commandSpecs = buildYtDlpCommandSpecs({
    url,
    outputTemplate,
    mode: "video",
    explicitBinary: process.env.YT_DLP_PATH?.trim(),
    freshPythonPackageDir,
  });

  const before = new Set((await fs.readdir(outputDir).catch(() => [])).map((file) => path.join(outputDir, file)));
  await runFirstSuccessfulCommand(commandSpecs, 30 * 60 * 1000, "video");
  const files = await fs.readdir(outputDir, { withFileTypes: true });
  const candidates = files
    .filter((entry) => entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(outputDir, entry.name));
  const newCandidates = candidates.filter((file) => !before.has(file));
  const selected = (newCandidates.length ? newCandidates : candidates)
    .sort()
    .at(-1);

  if (!selected) {
    throw new Error("YouTube se descargó, pero no encontré el archivo de video resultante.");
  }

  const parsed = path.parse(selected);
  const safePath = path.join(parsed.dir, `${sanitizeDownloadedVideoName(parsed.name)}${parsed.ext.toLowerCase()}`);
  if (safePath !== selected && !(await pathExists(safePath))) {
    await fs.rename(selected, safePath);
    return safePath;
  }
  return selected;
}

async function downloadYoutubeAudio(url: string, outputDir: string): Promise<string> {
  if (!isYouTubeUrl(url)) {
    throw new Error("El link de audio no parece ser de YouTube.");
  }

  await fs.mkdir(outputDir, { recursive: true });
  const outputTemplate = path.join(outputDir, "audio_%(title).120s-%(id)s.%(ext)s");
  const freshPythonPackageDir = await getFreshYtDlpPythonPackageDir();
  const commandSpecs = buildYtDlpCommandSpecs({
    url,
    outputTemplate,
    mode: "audio",
    explicitBinary: process.env.YT_DLP_PATH?.trim(),
    freshPythonPackageDir,
  });

  const before = new Set((await fs.readdir(outputDir).catch(() => [])).map((file) => path.join(outputDir, file)));
  await runFirstSuccessfulCommand(commandSpecs, 30 * 60 * 1000, "audio");
  const files = await fs.readdir(outputDir, { withFileTypes: true });
  const candidates = files
    .filter((entry) => entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(outputDir, entry.name));
  const newCandidates = candidates.filter((file) => !before.has(file));
  const selected = (newCandidates.length ? newCandidates : candidates)
    .sort()
    .at(-1);

  if (!selected) {
    throw new Error("YouTube descargó el audio, pero no encontré el archivo resultante.");
  }

  return selected;
}

async function resolveExistingDriveFolderId(folderPath: string[], userId: string, parentFolderId?: string | null): Promise<{ folderId: string | null; folderName: string; ambiguousMatches?: Array<{ id: string; name: string; webViewLink: string | null }> }> {
  const cleanPath = folderPath.map((part) => part.trim()).filter(Boolean);
  const folderName = cleanPath.at(-1) || "Drive";
  if (cleanPath.length === 0) return { folderId: parentFolderId || null, folderName };

  if (parentFolderId) {
    return {
      folderId: await findDriveFolderPathUnderParent(cleanPath, parentFolderId, userId),
      folderName,
    };
  }

  if (cleanPath.length > 1) {
    return {
      folderId: await findDriveFolderPath(cleanPath, userId),
      folderName,
    };
  }

  const matches = await searchDriveFoldersByName(folderName, userId);
  if (matches.length === 1) {
    return { folderId: matches[0].id, folderName };
  }
  if (matches.length > 1) {
    return { folderId: null, folderName, ambiguousMatches: matches };
  }

  return { folderId: null, folderName };
}

async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`No pude leer la duración de ${path.basename(videoPath)}`);
  }
  return duration;
}

async function getVideoResolution(videoPath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=s=x:p=0",
    videoPath,
  ]);
  const [width, height] = stdout.trim().split("x").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`No pude leer el tamaño de ${path.basename(videoPath)}`);
  }
  return { width, height };
}

async function hasAudio(videoPath: string): Promise<boolean> {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=index",
    "-of",
    "csv=p=0",
    videoPath,
  ]);
  return stdout.trim().length > 0;
}

function clipStartAroundDrop(duration: number, targetSeconds: number, dropSecond: number): number {
  const clipDuration = Math.min(targetSeconds, duration);
  const start = dropSecond - clipDuration / 2;
  return Math.max(0, Math.min(start, Math.max(0, duration - clipDuration)));
}

async function measureAudioMeanVolume(videoPath: string, start: number, seconds: number): Promise<number> {
  const { stderr } = await runCommand("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-ss",
    start.toFixed(3),
    "-t",
    seconds.toFixed(3),
    "-i",
    videoPath,
    "-vn",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ], { timeoutMs: 30000 });

  const match = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
  if (!match) return Number.NEGATIVE_INFINITY;
  return Number.parseFloat(match[1]);
}

async function findBestDropSeconds(videoPath: string, duration: number, count: number): Promise<number[]> {
  const requestedCount = normalizeClipCount(count, 1);
  if (!(await hasAudio(videoPath))) {
    return evenlyDistributedDropSeconds(duration, requestedCount);
  }

  const sampleSeconds = Math.min(10, Math.max(3, duration / 8));
  const stepSeconds = duration > 900 ? 30 : duration > 300 ? 20 : 10;
  const maxStart = Math.max(0, duration - sampleSeconds);
  const candidates: Array<{ second: number; volume: number }> = [];

  for (let start = 0; start <= maxStart; start += stepSeconds) {
    const volume = await measureAudioMeanVolume(videoPath, start, sampleSeconds).catch(() => Number.NEGATIVE_INFINITY);
    candidates.push({ second: Math.min(duration, start + sampleSeconds / 2), volume });
  }

  if (!candidates.length) {
    return evenlyDistributedDropSeconds(duration, requestedCount);
  }

  const spacingSeconds = Math.min(75, Math.max(20, duration / Math.max(2, requestedCount + 1)));
  const selected: number[] = [];
  for (const candidate of candidates.sort((a, b) => b.volume - a.volume)) {
    if (selected.some((second) => Math.abs(second - candidate.second) < spacingSeconds)) continue;
    selected.push(candidate.second);
    if (selected.length >= requestedCount) break;
  }

  if (selected.length < requestedCount) {
    selected.push(...candidates.map((candidate) => candidate.second));
  }

  return uniqueDropSeconds(selected, duration).slice(0, requestedCount);
}

async function findBestDropSecond(videoPath: string, duration: number): Promise<number> {
  return (await findBestDropSeconds(videoPath, duration, 1))[0] ?? duration / 2;
}

async function detectDjNameByOcr(videoPath: string): Promise<string | null> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radio-dj-ocr-"));
  try {
    const duration = await getVideoDuration(videoPath);
    const sampleTimes = [
      Math.min(Math.max(2, duration * 0.08), Math.max(0, duration - 1)),
      Math.min(Math.max(8, duration * 0.25), Math.max(0, duration - 1)),
      Math.min(Math.max(15, duration * 0.5), Math.max(0, duration - 1)),
    ];

    for (const [index, sampleAt] of sampleTimes.entries()) {
      const framePath = path.join(tempDir, `frame-${index}.png`);
      await runCommand("ffmpeg", [
        "-y",
        "-ss",
        sampleAt.toFixed(3),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        framePath,
      ], { timeoutMs: 30000 });

      const { width, height } = await getVideoResolution(framePath);
      const cropSpecs = [
        { width: 0.42, height: 0.18, y: 0.76 },
        { width: 0.48, height: 0.22, y: 0.72 },
      ];

      for (const [cropIndex, crop] of cropSpecs.entries()) {
        const cropPath = path.join(tempDir, `name-${index}-${cropIndex}.png`);
        const cropWidth = Math.round(width * crop.width);
        const cropHeight = Math.round(height * crop.height);
        const cropY = Math.round(height * crop.y);

        await runCommand("magick", [
          framePath,
          "-crop",
          `${cropWidth}x${cropHeight}+0+${cropY}`,
          "-colorspace",
          "Gray",
          "-resize",
          "300%",
          "-contrast-stretch",
          "0x20%",
          "-threshold",
          "55%",
          cropPath,
        ], { timeoutMs: 30000 });

        const { stdout } = await runCommand("tesseract", [
          cropPath,
          "stdout",
          "--psm",
          "7",
          "-c",
          "tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-. ",
        ], { timeoutMs: 30000 });

        const detected = cleanOcrName(stdout);
        if (detected) return detected;
      }
    }

    return null;
  } catch (error) {
    console.warn("[radio-video-edit] OCR failed:", error instanceof Error ? error.message : error);
    return null;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function collectVideos(dir: string, maxDepth: number): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (/^(CapCut|JianyingPro)$/i.test(entry.name) || /cache/i.test(entry.name)) continue;
        await walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || entry.name.startsWith("._")) continue;
      if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir, 0);
  return results.sort();
}

export async function findRadioVideos(options: {
  sourceDir?: string;
  fallbackInputDir?: string;
  searchDepth?: number;
} = {}): Promise<string[]> {
  const sourceDir = options.sourceDir || path.join(os.homedir(), "Movies");
  const fallbackInputDir = options.fallbackInputDir || DEFAULT_FALLBACK_INPUT_DIR;
  const searchDepth = options.searchDepth ?? 3;
  const sourceVideos = await collectVideos(sourceDir, searchDepth);
  if (sourceVideos.length > 0) return sourceVideos;
  return collectVideos(fallbackInputDir, 1);
}

function buildOutputPath(outputDir: string, djName: string, suffix: string): string {
  return path.join(outputDir, `${sanitizeDjName(djName)}_${suffix}.mp4`);
}

async function renderClip(params: {
  videoPath: string;
  outputPath: string;
  start: number;
  duration: number;
  mode: "horizontal_ig" | "vertical_tiktok";
  force?: boolean;
  musicPath?: string;
  musicStart?: number;
}): Promise<void> {
  if (!params.force && await pathExists(params.outputPath)) return;

  const filter = params.mode === "horizontal_ig"
    ? "scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
    : "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1";

  const fadeOutStart = Math.max(0, params.duration - 0.25);
  const args = [
    "-y",
    "-ss",
    params.start.toFixed(3),
    "-t",
    params.duration.toFixed(3),
    "-i",
    params.videoPath,
  ];

  if (params.musicPath) {
    args.push(
      "-ss",
      (params.musicStart || 0).toFixed(3),
      "-t",
      params.duration.toFixed(3),
      "-i",
      params.musicPath,
    );
  }

  args.push(
    "-vf",
    filter,
    "-map",
    "0:v:0",
    "-map",
    params.musicPath ? "1:a:0" : "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
  );

  if (params.musicPath) {
    args.push(
      "-af",
      `afade=t=in:st=0:d=0.15,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.25`,
      "-shortest",
    );
  }

  args.push(
    "-movflags",
    "+faststart",
    params.outputPath,
  );

  await runCommand("ffmpeg", args, { timeoutMs: 30 * 60 * 1000 });
}

function resolveDriveOutputDir(folderName: string): string | null {
  const explicit = process.env.DRIVE_OUTPUT_DIR?.trim();
  if (explicit) return explicit;
  const cloudStorage = path.join(os.homedir(), "Library", "CloudStorage");
  return path.join(cloudStorage, "__AUTO_DISCOVER__", DRIVE_APP_ROOT_FOLDER, DRIVE_BLACK_ROOM_VIDEOS_FOLDER, folderName);
}

async function copyToGoogleDriveDesktop(filePath: string, folderName = IG_RADIO_FOLDER_NAME): Promise<string | null> {
  const driveTarget = resolveDriveOutputDir(folderName);
  if (!driveTarget) return null;

  if (driveTarget.includes("__AUTO_DISCOVER__")) {
    const cloudRoot = path.dirname(path.dirname(driveTarget));
    const entries = await fs.readdir(cloudRoot, { withFileTypes: true }).catch(() => []);
    const driveEntry = entries.find((entry) => entry.isDirectory() && entry.name.startsWith("GoogleDrive"));
    if (!driveEntry) return null;

    const driveRoot = path.join(cloudRoot, driveEntry.name);
    const myDrive = await pathExists(path.join(driveRoot, "My Drive"))
      ? path.join(driveRoot, "My Drive")
      : await pathExists(path.join(driveRoot, "Mi unidad"))
        ? path.join(driveRoot, "Mi unidad")
        : driveRoot;
    const destinationDir = path.join(myDrive, DRIVE_APP_ROOT_FOLDER, DRIVE_BLACK_ROOM_VIDEOS_FOLDER, folderName);
    await fs.mkdir(destinationDir, { recursive: true });
    const destination = path.join(destinationDir, path.basename(filePath));
    await fs.copyFile(filePath, destination);
    return destination;
  }

  await fs.mkdir(driveTarget, { recursive: true });
  const destination = path.join(driveTarget, path.basename(filePath));
  await fs.copyFile(filePath, destination);
  return destination;
}

async function deleteSourceVideoAfterSuccess(videoPath: string, sourceDir?: string): Promise<{
  deleted: boolean;
  path?: string;
  error?: string;
}> {
  if (!sourceDir) return { deleted: false };

  const resolvedSourceDir = path.resolve(sourceDir);
  const resolvedVideoPath = path.resolve(videoPath);
  if (!resolvedVideoPath.startsWith(`${resolvedSourceDir}${path.sep}`)) {
    return { deleted: false };
  }

  try {
    await fs.rm(resolvedVideoPath, { force: true });
    return {
      deleted: !(await pathExists(resolvedVideoPath)),
      path: resolvedVideoPath,
    };
  } catch (error) {
    return {
      deleted: false,
      path: resolvedVideoPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function renderRadioVideoJob(input: RadioVideoJobInput & { djName: string; force?: boolean }): Promise<RenderedClip[]> {
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "radio-drive-upload-"));

  const duration = await getVideoDuration(input.videoPath);
  const instagramClipCount = normalizeClipCount(input.instagramClipCount, DEFAULT_INSTAGRAM_CLIP_COUNT);
  const tiktokClipCount = normalizeClipCount(input.tiktokClipCount, DEFAULT_TIKTOK_CLIP_COUNT);
  const maxClipCount = Math.max(instagramClipCount, tiktokClipCount);
  const knownDropSeconds = uniqueDropSeconds([
    ...(input.bestDropSeconds || []),
    ...(typeof input.bestDropSecond === "number" ? [input.bestDropSecond] : []),
  ], duration);
  const detectedDropSeconds = knownDropSeconds.length >= maxClipCount
    ? knownDropSeconds
    : uniqueDropSeconds([
      ...knownDropSeconds,
      ...await findBestDropSeconds(input.videoPath, duration, maxClipCount),
      ...evenlyDistributedDropSeconds(duration, maxClipCount),
    ], duration);
  const dropSeconds = detectedDropSeconds.length
    ? detectedDropSeconds.slice(0, maxClipCount)
    : [duration / 2];
  const longDuration = Math.min(60, duration);
  const shortDuration = Math.min(30, duration);
  const musicDuration = input.musicPath ? await getVideoDuration(input.musicPath) : null;
  const musicDropSecond = input.musicPath && musicDuration
    ? await findBestDropSecond(input.musicPath, musicDuration)
    : null;

  try {
    const clips: RenderedClip[] = [];

    for (let index = 0; index < instagramClipCount; index += 1) {
      const dropSecond = dropSeconds[index % dropSeconds.length];
      const start = clipStartAroundDrop(duration, longDuration, dropSecond);
      const musicStart = input.musicPath && musicDuration && musicDropSecond !== null
        ? clipStartAroundDrop(musicDuration, longDuration, musicDropSecond)
        : undefined;
      const suffix = instagramClipCount === 1
        ? "60s_horizontal_ig"
        : `60s_instagram_4x5_clip${String(index + 1).padStart(2, "0")}`;
      const outputPath = buildOutputPath(stagingDir, input.djName, suffix);

      await renderClip({
        videoPath: input.videoPath,
        outputPath,
        start,
        duration: longDuration,
        mode: "horizontal_ig",
        force: true,
        musicPath: input.musicPath,
        musicStart,
      });

      clips.push({
        kind: "horizontal_ig",
        path: outputPath,
        driveFolderName: IG_RADIO_FOLDER_NAME,
        durationSeconds: longDuration,
        width: 1080,
        height: 1350,
        audioSource: input.musicPath ? "music_drop" : "source_drop",
        musicDropSecond: input.musicPath ? musicDropSecond ?? undefined : dropSecond,
        clipNumber: index + 1,
        startSecond: start,
      });
    }

    for (let index = 0; index < tiktokClipCount; index += 1) {
      const dropSecond = dropSeconds[index % dropSeconds.length];
      const start = clipStartAroundDrop(duration, shortDuration, dropSecond);
      const musicStart = input.musicPath && musicDuration && musicDropSecond !== null
        ? clipStartAroundDrop(musicDuration, shortDuration, musicDropSecond)
        : undefined;
      const suffix = tiktokClipCount === 1
        ? "30s_vertical_tiktok"
        : `30s_vertical_tiktok_clip${String(index + 1).padStart(2, "0")}`;
      const outputPath = buildOutputPath(stagingDir, input.djName, suffix);

      await renderClip({
        videoPath: input.videoPath,
        outputPath,
        start,
        duration: shortDuration,
        mode: "vertical_tiktok",
        force: true,
        musicPath: input.musicPath,
        musicStart,
      });

      clips.push({
        kind: "vertical_tiktok",
        path: outputPath,
        driveFolderName: TIKTOK_RADIO_FOLDER_NAME,
        durationSeconds: shortDuration,
        width: 1080,
        height: 1920,
        audioSource: input.musicPath ? "music_drop" : "source_drop",
        musicDropSecond: input.musicPath ? musicDropSecond ?? undefined : dropSecond,
        clipNumber: index + 1,
        startSecond: start,
      });
    }

    for (const clip of clips) {
      const folderName = input.driveFolderName || clip.driveFolderName || IG_RADIO_FOLDER_NAME;
      const folderId = input.driveFolderId || await ensureAppDriveFolderPath([DRIVE_BLACK_ROOM_VIDEOS_FOLDER, folderName], input.userId);
      const upload = await uploadLocalFileToDriveFolder({
        filePath: clip.path,
        folderId,
        mimeType: "video/mp4",
        userId: input.userId,
      });
      clip.driveFolderName = folderName;
      clip.driveFileId = upload.fileId;
      clip.driveWebViewLink = upload.webViewLink;
    }

    if (process.env.RADIO_EDIT_COPY_TO_DRIVE_DESKTOP === "1") {
      for (const clip of clips) {
        await copyToGoogleDriveDesktop(clip.path, clip.driveFolderName || IG_RADIO_FOLDER_NAME).catch((error) => {
          console.warn("[radio-video-edit] Google Drive Desktop copy failed:", error instanceof Error ? error.message : error);
        });
      }
    }

    return clips;
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function notifyMissingDjName(userId: string, pendingActionId: string, videoPath: string): Promise<void> {
  const fileName = path.basename(videoPath);
  const command = `nombre ${pendingActionId} DJ NAME`;
  const message = [
    `No sé el nombre del DJ para ${fileName}.`,
    `Responde: ${command}`,
    "",
    "Ejemplo:",
    `nombre ${pendingActionId} MYNA`,
  ].join("\n");

  const telegramConfig = await storage.getTelegramConfig(userId).catch(() => undefined);
  const botToken = getTelegramBotToken();
  if (botToken && telegramConfig?.enabled && telegramConfig.chatId) {
    await sendTelegramPlainMessage(botToken, telegramConfig.chatId, message).catch((error) => {
      console.warn("[radio-video-edit] Telegram notification failed:", error instanceof Error ? error.message : error);
    });
  }

  await sendPushNotification(userId, {
    title: "Falta nombre del DJ",
    body: `No sé el nombre del DJ para ${fileName}.`,
    url: "/?pending=radio_edit.resolve_dj_name",
    tag: `radio-edit-name-${pendingActionId}`,
  }).catch((error) => {
    console.warn("[radio-video-edit] Push notification failed:", error instanceof Error ? error.message : error);
  });
}

async function createMissingDjNameAction(params: {
  userId: string;
  videoPath: string;
  sourceDir?: string;
  fallbackInputDir?: string;
  outputDir?: string;
  bestDropSecond?: number;
  bestDropSeconds?: number[];
  driveFolderId?: string;
  driveFolderName?: string;
  driveFolderPath?: string[];
  driveParentFolderId?: string;
  musicPath?: string;
  musicUrl?: string;
  instagramClipCount?: number;
  tiktokClipCount?: number;
  deleteSourceAfterSuccess?: boolean;
}): Promise<string> {
  const existing = (await storage.getPendingActions(params.userId)).find((action) => (
    action.actionType === "radio_edit.resolve_dj_name" &&
    action.resourceId === params.videoPath &&
    ["pending", "edited", "snoozed", "approved", "executing"].includes(action.status)
  ));
  if (existing) return existing.id;

  const pendingAction = await createPendingActionForApproval({
    userId: params.userId,
    actorType: "scheduler",
    actorId: "radio-video-edit-agent",
    origin: "scheduler",
    executionMode: "user_requested",
    actionType: "radio_edit.resolve_dj_name",
    resourceType: "radio_video",
    resourceId: params.videoPath,
    title: "Falta nombre del DJ",
    description: `No pude leer el nombre del DJ en ${path.basename(params.videoPath)}. Escribe el nombre para generar los clips.`,
    input: {
      videoPath: params.videoPath,
      sourceDir: params.sourceDir,
      fallbackInputDir: params.fallbackInputDir,
      outputDir: params.outputDir || DEFAULT_OUTPUT_DIR,
      bestDropSecond: params.bestDropSecond,
      bestDropSeconds: params.bestDropSeconds,
      driveFolderId: params.driveFolderId,
      driveFolderName: params.driveFolderName,
      driveFolderPath: params.driveFolderPath,
      driveParentFolderId: params.driveParentFolderId,
      musicPath: params.musicPath,
      musicUrl: params.musicUrl,
      instagramClipCount: params.instagramClipCount,
      tiktokClipCount: params.tiktokClipCount,
      deleteSourceAfterSuccess: params.deleteSourceAfterSuccess,
    },
    proposedChanges: {
      expectedTelegramFormat: "nombre <pendingActionId> MYNA",
      outputs: [
        `<DJ>_${normalizeClipCount(params.instagramClipCount, DEFAULT_INSTAGRAM_CLIP_COUNT) === 1 ? "60s_horizontal_ig.mp4" : "60s_instagram_4x5_clipNN.mp4"}`,
        `<DJ>_${normalizeClipCount(params.tiktokClipCount, DEFAULT_TIKTOK_CLIP_COUNT) === 1 ? "30s_vertical_tiktok.mp4" : "30s_vertical_tiktok_clipNN.mp4"}`,
      ],
    },
    metadata: { status: "needs_dj_name" satisfies RadioEditStatus },
    scope: "system",
  });

  await notifyMissingDjName(params.userId, pendingAction.id, params.videoPath);
  return pendingAction.id;
}

export async function processRadioVideo(params: {
  userId: string;
  videoPath: string;
  sourceDir?: string;
  fallbackInputDir?: string;
  outputDir?: string;
  force?: boolean;
  djName?: string;
  driveFolderId?: string;
  driveFolderName?: string;
  driveFolderPath?: string[];
  driveParentFolderId?: string;
  musicPath?: string;
  musicUrl?: string;
  instagramClipCount?: number;
  tiktokClipCount?: number;
  deleteSourceAfterSuccess?: boolean;
}): Promise<RadioVideoProcessResult> {
  try {
    const instagramClipCount = normalizeClipCount(params.instagramClipCount, DEFAULT_INSTAGRAM_CLIP_COUNT);
    const tiktokClipCount = normalizeClipCount(params.tiktokClipCount, DEFAULT_TIKTOK_CLIP_COUNT);
    const duration = await getVideoDuration(params.videoPath);
    const bestDropSeconds = await findBestDropSeconds(params.videoPath, duration, Math.max(instagramClipCount, tiktokClipCount));
    const bestDropSecond = bestDropSeconds[0] ?? duration / 2;
    const djName = sanitizeDjName(params.djName || "") || await detectDjNameByOcr(params.videoPath);

    if (!djName) {
      const pendingActionId = await createMissingDjNameAction({
        userId: params.userId,
        videoPath: params.videoPath,
        sourceDir: params.sourceDir,
        fallbackInputDir: params.fallbackInputDir,
        outputDir: params.outputDir,
        bestDropSecond,
        bestDropSeconds,
        driveFolderId: params.driveFolderId,
        driveFolderName: params.driveFolderName,
        driveFolderPath: params.driveFolderPath,
        driveParentFolderId: params.driveParentFolderId,
        musicPath: params.musicPath,
        musicUrl: params.musicUrl,
        instagramClipCount,
        tiktokClipCount,
        deleteSourceAfterSuccess: params.deleteSourceAfterSuccess,
      });
      return { videoPath: params.videoPath, status: "needs_dj_name", pendingActionId };
    }

    const clips = await renderRadioVideoJob({
      videoPath: params.videoPath,
      outputDir: params.outputDir,
      sourceDir: params.sourceDir,
      fallbackInputDir: params.fallbackInputDir,
      bestDropSecond,
      bestDropSeconds,
      djName,
      force: params.force,
      userId: params.userId,
      driveFolderId: params.driveFolderId,
      driveFolderName: params.driveFolderName,
      driveFolderPath: params.driveFolderPath,
      driveParentFolderId: params.driveParentFolderId,
      musicPath: params.musicPath,
      musicUrl: params.musicUrl,
      instagramClipCount,
      tiktokClipCount,
      deleteSourceAfterSuccess: params.deleteSourceAfterSuccess,
    });

    await writeAuditLog({
      userId: params.userId,
      actorType: "scheduler",
      actorId: "radio-video-edit-agent",
      origin: "scheduler",
      actionType: "radio_edit.render",
      resourceType: "radio_video",
      resourceId: params.videoPath,
      metadata: { djName, bestDropSecond, clips },
      status: "succeeded",
      executionMode: "user_requested",
    }).catch(() => undefined);

    const cleanup = params.deleteSourceAfterSuccess
      ? await deleteSourceVideoAfterSuccess(params.videoPath, params.sourceDir)
      : { deleted: false };

    return {
      videoPath: params.videoPath,
      status: "completed",
      djName,
      clips,
      sourceVideoDeleted: cleanup.deleted || undefined,
      sourceVideoDeletedPath: cleanup.deleted ? cleanup.path : undefined,
      sourceVideoCleanupError: cleanup.error,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return { videoPath: params.videoPath, status: "failed", error: errorMessage };
  }
}

export async function processRadioVideos(options: {
  userId: string;
  sourceDir?: string;
  fallbackInputDir?: string;
  outputDir?: string;
  searchDepth?: number;
  force?: boolean;
  driveFolderId?: string;
  driveFolderName?: string;
  driveFolderPath?: string[];
  driveParentFolderId?: string;
  musicPath?: string;
  musicUrl?: string;
  instagramClipCount?: number;
  tiktokClipCount?: number;
  deleteSourceAfterSuccess?: boolean;
}): Promise<RadioVideoProcessResult[]> {
  const sourceDir = options.sourceDir || path.join(os.homedir(), "Movies");
  const fallbackInputDir = options.fallbackInputDir || DEFAULT_FALLBACK_INPUT_DIR;
  const videos = await findRadioVideos({
    sourceDir,
    fallbackInputDir,
    searchDepth: options.searchDepth,
  });

  const results: RadioVideoProcessResult[] = [];
  for (const videoPath of videos) {
    results.push(await processRadioVideo({
      userId: options.userId,
      videoPath,
      sourceDir,
      fallbackInputDir,
      outputDir: options.outputDir || DEFAULT_OUTPUT_DIR,
      force: options.force,
      driveFolderId: options.driveFolderId,
      driveFolderName: options.driveFolderName,
      driveFolderPath: options.driveFolderPath,
      driveParentFolderId: options.driveParentFolderId,
      musicPath: options.musicPath,
      musicUrl: options.musicUrl,
      instagramClipCount: options.instagramClipCount,
      tiktokClipCount: options.tiktokClipCount,
      deleteSourceAfterSuccess: options.deleteSourceAfterSuccess,
    }));
  }
  return results;
}

export async function createRadioYoutubeDriveFolderConfirmation(params: {
  userId: string;
  youtubeUrl: string;
  driveFolderPath: string[];
  driveParentFolderId?: string;
  djName?: string;
  musicUrl?: string;
  instagramClipCount?: number;
  tiktokClipCount?: number;
  deleteSourceAfterSuccess?: boolean;
  origin?: "web" | "telegram" | "scheduler";
  ambiguousMatches?: Array<{ id: string; name: string; webViewLink: string | null }>;
}): Promise<string> {
  const folderLabel = params.driveFolderPath.join("/");
  const existing = (await storage.getPendingActions(params.userId)).find((action) => (
    action.actionType === "radio_edit.youtube_to_drive" &&
    action.resourceId === params.youtubeUrl &&
    ["pending", "edited", "snoozed", "approved", "executing"].includes(action.status)
  ));
  if (existing) return existing.id;

  const pendingAction = await createPendingActionForApproval({
    userId: params.userId,
    actorType: "assistant",
    actorId: "radio-youtube-agent",
    origin: params.origin || "web",
    executionMode: "user_requested",
    actionType: "radio_edit.youtube_to_drive",
    resourceType: "youtube_video",
    resourceId: params.youtubeUrl,
    title: `Crear clips de radio desde YouTube`,
    description: params.ambiguousMatches?.length
      ? `Encontré más de una carpeta llamada ${folderLabel}. Confirma la ruta exacta antes de guardar.`
      : `No encontré la carpeta ${folderLabel} en Google Drive. Confirma si quieres crearla y guardar ahí los clips.`,
    input: {
      youtubeUrl: params.youtubeUrl,
      driveFolderPath: params.driveFolderPath,
      driveParentFolderId: params.driveParentFolderId,
      createFolderIfMissing: true,
      djName: params.djName,
      musicUrl: params.musicUrl,
      instagramClipCount: params.instagramClipCount,
      tiktokClipCount: params.tiktokClipCount,
      deleteSourceAfterSuccess: params.deleteSourceAfterSuccess,
    },
    proposedChanges: {
      youtubeUrl: params.youtubeUrl,
      driveFolderPath: params.driveFolderPath,
      driveParentFolderId: params.driveParentFolderId,
      djName: params.djName,
      musicUrl: params.musicUrl,
      instagramClipCount: normalizeClipCount(params.instagramClipCount, DEFAULT_INSTAGRAM_CLIP_COUNT),
      tiktokClipCount: normalizeClipCount(params.tiktokClipCount, DEFAULT_TIKTOK_CLIP_COUNT),
      deleteSourceAfterSuccess: params.deleteSourceAfterSuccess,
      outputs: [
        `<DJ>_${normalizeClipCount(params.instagramClipCount, DEFAULT_INSTAGRAM_CLIP_COUNT) === 1 ? "60s_horizontal_ig.mp4" : "60s_instagram_4x5_clipNN.mp4"}`,
        `<DJ>_${normalizeClipCount(params.tiktokClipCount, DEFAULT_TIKTOK_CLIP_COUNT) === 1 ? "30s_vertical_tiktok.mp4" : "30s_vertical_tiktok_clipNN.mp4"}`,
      ],
      ambiguousMatches: params.ambiguousMatches || [],
    },
    metadata: { status: "needs_drive_folder_confirmation" },
    scope: "system",
  });

  return pendingAction.id;
}

export async function createRadioDriveVideoFolderConfirmation(params: {
  userId: string;
  sourceDriveFileId: string;
  sourceDriveUrl?: string;
  driveFolderPath: string[];
  driveParentFolderId?: string;
  djName?: string;
  musicUrl?: string;
  instagramClipCount?: number;
  tiktokClipCount?: number;
  deleteSourceAfterSuccess?: boolean;
  origin?: "web" | "telegram" | "scheduler";
  ambiguousMatches?: Array<{ id: string; name: string; webViewLink: string | null }>;
}): Promise<string> {
  const folderLabel = params.driveFolderPath.join("/");
  const existing = (await storage.getPendingActions(params.userId)).find((action) => (
    action.actionType === "radio_edit.drive_video_to_drive" &&
    action.resourceId === params.sourceDriveFileId &&
    ["pending", "edited", "snoozed", "approved", "executing"].includes(action.status)
  ));
  if (existing) return existing.id;

  const pendingAction = await createPendingActionForApproval({
    userId: params.userId,
    actorType: "assistant",
    actorId: "radio-drive-video-agent",
    origin: params.origin || "web",
    executionMode: "user_requested",
    actionType: "radio_edit.drive_video_to_drive",
    resourceType: "drive_video",
    resourceId: params.sourceDriveFileId,
    title: "Crear clips de radio desde MP4 de Drive",
    description: params.ambiguousMatches?.length
      ? `Encontré más de una carpeta llamada ${folderLabel}. Confirma la ruta exacta antes de guardar.`
      : `No encontré la carpeta ${folderLabel} en Google Drive. Confirma si quieres crearla y guardar ahí los clips.`,
    input: {
      sourceDriveFileId: params.sourceDriveFileId,
      sourceDriveUrl: params.sourceDriveUrl,
      driveFolderPath: params.driveFolderPath,
      driveParentFolderId: params.driveParentFolderId,
      createFolderIfMissing: true,
      djName: params.djName,
      musicUrl: params.musicUrl,
      instagramClipCount: params.instagramClipCount,
      tiktokClipCount: params.tiktokClipCount,
      deleteSourceAfterSuccess: params.deleteSourceAfterSuccess,
    },
    proposedChanges: {
      sourceDriveFileId: params.sourceDriveFileId,
      sourceDriveUrl: params.sourceDriveUrl,
      driveFolderPath: params.driveFolderPath,
      driveParentFolderId: params.driveParentFolderId,
      djName: params.djName,
      musicUrl: params.musicUrl,
      instagramClipCount: normalizeClipCount(params.instagramClipCount, DEFAULT_INSTAGRAM_CLIP_COUNT),
      tiktokClipCount: normalizeClipCount(params.tiktokClipCount, DEFAULT_TIKTOK_CLIP_COUNT),
      deleteSourceAfterSuccess: params.deleteSourceAfterSuccess,
      outputs: [
        `<DJ>_${normalizeClipCount(params.instagramClipCount, DEFAULT_INSTAGRAM_CLIP_COUNT) === 1 ? "60s_horizontal_ig.mp4" : "60s_instagram_4x5_clipNN.mp4"}`,
        `<DJ>_${normalizeClipCount(params.tiktokClipCount, DEFAULT_TIKTOK_CLIP_COUNT) === 1 ? "30s_vertical_tiktok.mp4" : "30s_vertical_tiktok_clipNN.mp4"}`,
      ],
      ambiguousMatches: params.ambiguousMatches || [],
    },
    metadata: { status: "needs_drive_folder_confirmation" },
    scope: "system",
  });

  return pendingAction.id;
}

export async function processYoutubeRadioVideoLink(params: {
  userId: string;
  youtubeUrl: string;
  driveFolderPath: string[] | string;
  driveParentFolderId?: string;
  createFolderIfMissing?: boolean;
  driveFolderPathFromYoutubeTitle?: boolean;
  sourceDir?: string;
  outputDir?: string;
  force?: boolean;
  djName?: string;
  musicUrl?: string;
  musicPath?: string;
  instagramClipCount?: number;
  tiktokClipCount?: number;
  deleteSourceAfterSuccess?: boolean;
}): Promise<RadioYoutubeProcessResult> {
  const driveFolderPath = Array.isArray(params.driveFolderPath)
    ? params.driveFolderPath.map((part) => part.trim()).filter(Boolean)
    : splitDriveFolderPath(params.driveFolderPath);
  const driveParentFolderId = params.driveParentFolderId || getConfiguredClippersDriveRootFolderId() || undefined;
  if (driveFolderPath.length === 0 && !params.driveFolderPathFromYoutubeTitle && !driveParentFolderId) {
    throw new Error("Falta la carpeta de Google Drive donde guardar los clips.");
  }

  const sourceDir = params.sourceDir || path.join(process.cwd(), "radio_video_edits", "01_originales", "youtube");
  const deleteSourceAfterSuccess = params.deleteSourceAfterSuccess ?? true;
  const videoPath = params.driveFolderPathFromYoutubeTitle
    ? await downloadYoutubeVideo(params.youtubeUrl, sourceDir)
    : null;
  if (params.driveFolderPathFromYoutubeTitle && videoPath) {
    driveFolderPath.push(folderNameFromDownloadedYoutubeVideo(videoPath));
  }

  const resolved = await resolveExistingDriveFolderId(driveFolderPath, params.userId, driveParentFolderId);
  if (resolved.ambiguousMatches?.length && !params.createFolderIfMissing) {
    return {
      youtubeUrl: params.youtubeUrl,
      videoPath: params.youtubeUrl,
      status: "failed",
      error: `Encontré varias carpetas llamadas ${driveFolderPath.join("/")}. Dime la ruta completa, por ejemplo "Robert A/Videos de Black Room/Radio Junio".`,
      driveFolderPath,
    };
  }

  let driveFolderId = resolved.folderId;
  let driveFolderCreated = false;
  if (!driveFolderId) {
    if (!params.createFolderIfMissing) {
      const pendingActionId = await createRadioYoutubeDriveFolderConfirmation({
        userId: params.userId,
        youtubeUrl: params.youtubeUrl,
        driveFolderPath,
        driveParentFolderId,
        djName: params.djName,
        musicUrl: params.musicUrl,
        instagramClipCount: params.instagramClipCount,
        tiktokClipCount: params.tiktokClipCount,
        deleteSourceAfterSuccess,
      });
      return {
        youtubeUrl: params.youtubeUrl,
        videoPath: params.youtubeUrl,
        status: "queued",
        pendingActionId,
        driveFolderPath,
      };
    }
    driveFolderId = driveParentFolderId
      ? await ensureDriveFolderPathUnderParent(driveFolderPath, driveParentFolderId, params.userId)
      : await ensureDriveFolderPath(driveFolderPath, params.userId);
    driveFolderCreated = true;
  }

  const resolvedVideoPath = videoPath || await downloadYoutubeVideo(params.youtubeUrl, sourceDir);
  const musicPath = params.musicPath || (params.musicUrl
    ? await downloadYoutubeAudio(params.musicUrl, path.join(sourceDir, "audio"))
    : undefined);
  const result = await processRadioVideo({
    userId: params.userId,
    videoPath: resolvedVideoPath,
    sourceDir,
    outputDir: params.outputDir,
    force: params.force,
    djName: params.djName,
    driveFolderId,
    driveFolderName: driveFolderPath.join("/"),
    driveFolderPath,
    driveParentFolderId,
    musicPath,
    musicUrl: params.musicUrl,
    instagramClipCount: params.instagramClipCount,
    tiktokClipCount: params.tiktokClipCount,
    deleteSourceAfterSuccess,
  });

  return {
    ...result,
    youtubeUrl: params.youtubeUrl,
    driveFolderPath,
    driveFolderId,
    driveFolderCreated,
    musicUrl: params.musicUrl,
    musicPath,
  };
}

export async function processDriveRadioVideoFile(params: {
  userId: string;
  sourceDriveFileId: string;
  sourceDriveUrl?: string;
  driveFolderPath: string[] | string;
  driveParentFolderId?: string;
  createFolderIfMissing?: boolean;
  sourceDir?: string;
  outputDir?: string;
  force?: boolean;
  djName?: string;
  musicUrl?: string;
  musicPath?: string;
  instagramClipCount?: number;
  tiktokClipCount?: number;
  deleteSourceAfterSuccess?: boolean;
}): Promise<RadioDriveVideoProcessResult> {
  const driveFolderPath = Array.isArray(params.driveFolderPath)
    ? params.driveFolderPath.map((part) => part.trim()).filter(Boolean)
    : splitDriveFolderPath(params.driveFolderPath);
  const driveParentFolderId = params.driveParentFolderId || getConfiguredClippersDriveRootFolderId() || undefined;
  if (driveFolderPath.length === 0 && !driveParentFolderId) {
    throw new Error("Falta la carpeta de Google Drive donde guardar los clips.");
  }

  const sourceDir = params.sourceDir || path.join(process.cwd(), "radio_video_edits", "01_originales", "drive");
  const deleteSourceAfterSuccess = params.deleteSourceAfterSuccess ?? true;
  const resolved = await resolveExistingDriveFolderId(driveFolderPath, params.userId, driveParentFolderId);
  if (resolved.ambiguousMatches?.length && !params.createFolderIfMissing) {
    return {
      sourceDriveFileId: params.sourceDriveFileId,
      sourceDriveUrl: params.sourceDriveUrl,
      videoPath: params.sourceDriveUrl || params.sourceDriveFileId,
      status: "failed",
      error: `Encontré varias carpetas llamadas ${driveFolderPath.join("/")}. Dime la ruta completa, por ejemplo "Robert A/Videos de Black Room/Radio Junio".`,
      driveFolderPath,
    };
  }

  let driveFolderId = resolved.folderId;
  let driveFolderCreated = false;
  if (!driveFolderId) {
    if (!params.createFolderIfMissing) {
      const pendingActionId = await createRadioDriveVideoFolderConfirmation({
        userId: params.userId,
        sourceDriveFileId: params.sourceDriveFileId,
        sourceDriveUrl: params.sourceDriveUrl,
        driveFolderPath,
        driveParentFolderId,
        djName: params.djName,
        musicUrl: params.musicUrl,
        instagramClipCount: params.instagramClipCount,
        tiktokClipCount: params.tiktokClipCount,
        deleteSourceAfterSuccess,
      });
      return {
        sourceDriveFileId: params.sourceDriveFileId,
        sourceDriveUrl: params.sourceDriveUrl,
        videoPath: params.sourceDriveUrl || params.sourceDriveFileId,
        status: "queued",
        pendingActionId,
        driveFolderPath,
      };
    }
    driveFolderId = driveParentFolderId
      ? await ensureDriveFolderPathUnderParent(driveFolderPath, driveParentFolderId, params.userId)
      : await ensureDriveFolderPath(driveFolderPath, params.userId);
    driveFolderCreated = true;
  }

  const downloaded = await downloadDriveFileToPath({
    fileId: params.sourceDriveFileId,
    outputDir: sourceDir,
    userId: params.userId,
    allowedExtensions: VIDEO_EXTENSIONS,
  });
  const musicPath = params.musicPath || (params.musicUrl
    ? await downloadYoutubeAudio(params.musicUrl, path.join(sourceDir, "audio"))
    : undefined);
  const result = await processRadioVideo({
    userId: params.userId,
    videoPath: downloaded.filePath,
    sourceDir,
    outputDir: params.outputDir,
    force: params.force,
    djName: params.djName,
    driveFolderId,
    driveFolderName: driveFolderPath.join("/"),
    driveFolderPath,
    driveParentFolderId,
    musicPath,
    musicUrl: params.musicUrl,
    instagramClipCount: params.instagramClipCount,
    tiktokClipCount: params.tiktokClipCount,
    deleteSourceAfterSuccess,
  });

  return {
    ...result,
    sourceDriveFileId: params.sourceDriveFileId,
    sourceDriveUrl: params.sourceDriveUrl,
    sourceDriveFileName: downloaded.name,
    driveFolderPath,
    driveFolderId,
    driveFolderCreated,
    musicUrl: params.musicUrl,
    musicPath,
  };
}

export async function resumeRadioVideoEditWithDjName(actionInput: RadioVideoJobInput): Promise<{
  djName: string;
  clips: RenderedClip[];
  sourceVideoDeleted?: boolean;
  sourceVideoDeletedPath?: string;
  sourceVideoCleanupError?: string;
}> {
  const djName = sanitizeDjName(String(actionInput.djName || ""));
  if (!djName) {
    throw new Error("Falta el nombre del DJ.");
  }
  if (!actionInput.videoPath) {
    throw new Error("Falta el video original para continuar el render.");
  }

  const clips = await renderRadioVideoJob({
    ...actionInput,
    djName,
  });
  const cleanup = actionInput.deleteSourceAfterSuccess
    ? await deleteSourceVideoAfterSuccess(actionInput.videoPath, actionInput.sourceDir)
    : { deleted: false };

  return {
    djName,
    clips,
    sourceVideoDeleted: cleanup.deleted || undefined,
    sourceVideoDeletedPath: cleanup.deleted ? cleanup.path : undefined,
    sourceVideoCleanupError: cleanup.error,
  };
}

export function parseDjNameResolutionCommand(message: string): { actionId: string; djName: string } | null {
  const match = message.trim().match(/^(?:nombre|dj)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+(.+)$/i);
  if (!match) return null;
  const djName = sanitizeDjName(match[2]);
  if (!djName) return null;
  return { actionId: match[1], djName };
}
