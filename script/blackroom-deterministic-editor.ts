import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { applyLocalEditorialReport } from "../server/blackroom-local-evidence";
import {
  BLACKROOM_CHANNEL_VIDEOS_URL,
  buildBlackRoomYtDlpAuthArgs,
  buildBlackRoomRenderArgs,
  downloadBlackRoomWindowWithFallback,
  commitBlackRoomReservation,
  findBlackRoomDropOffset,
  parseBlackRoomEnergySamples,
  planBlackRoomDeterministicEdit,
  isOwnedBlackRoomMetadata,
  type BlackRoomEditPlan,
  type BlackRoomInventoryVideo,
} from "../server/blackroom-deterministic-editor";
import {
  BLACKROOM_QUEUE_PATH,
  recordBlackRoomFailedSource,
  readBlackRoomQueue,
  withBlackRoomQueueLock,
  writeBlackRoomQueue,
  type BlackRoomQueueState,
} from "../server/blackroom-daily-queue";
import {
  BLACKROOM_FFPROBE_SHOW_ENTRIES,
  BLACKROOM_WORKER_LEDGER_PATH,
  isBlackRoomJobPublishable,
  validateBlackRoomAudioLoudness,
  validateBlackRoomRenderProbe,
  type BlackRoomWorkerLedger,
} from "../server/blackroom-local-worker";

const execFileAsync = promisify(execFile);
const projectDir = path.resolve(process.env.BLACKROOM_PROJECT_DIR || process.cwd());
const queuePath = path.join(projectDir, process.env.BLACKROOM_QUEUE_PATH || BLACKROOM_QUEUE_PATH);
const ledgerPath = path.join(projectDir, BLACKROOM_WORKER_LEDGER_PATH);
const activityPath = path.join(projectDir, "clippers_workspace/blackroom/agent/activity-log.json");
const sourceDir = path.join(projectDir, "clippers_workspace/blackroom/sources");
const renderDir = path.join(projectDir, "clippers_workspace/blackroom/rendered");
const editorTemporaryRoot = path.join(projectDir, "clippers_workspace/blackroom/agent/editor-tmp");
const ytDlpPath = process.env.BLACKROOM_YTDLP_PATH || "/opt/homebrew/bin/yt-dlp";
const ffmpegPath = process.env.BLACKROOM_FFMPEG_PATH || "/opt/homebrew/bin/ffmpeg";
const ffprobePath = process.env.BLACKROOM_FFPROBE_PATH || "/opt/homebrew/bin/ffprobe";
const npmPath = process.env.BLACKROOM_NPM_PATH || "npm";
const ytDlpAuthArgs = buildBlackRoomYtDlpAuthArgs();
const ytDlpTimeoutMs = Math.max(60_000, Number(process.env.BLACKROOM_YTDLP_TIMEOUT_MS || 12 * 60_000));
let activeCleanup: (() => Promise<void>) | null = null;

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function appendActivity(message: string, stage = "edición", level: "info" | "success" | "error" = "info"): Promise<void> {
  const createdAt = new Date().toISOString();
  const event = { id: `${createdAt}-${stage}`, createdAt, stage, level, message: message.slice(0, 1_000) };
  const activity = await readJson<any[]>(activityPath).catch(() => []);
  activity.push(event);
  await mkdir(path.dirname(activityPath), { recursive: true });
  const temporary = `${activityPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(activity.slice(-80), null, 2)}\n`, "utf8");
  await rename(temporary, activityPath);
  console.log(message);
}

async function run(file: string, args: string[], maxBuffer = 64 * 1024 * 1024, timeout?: number) {
  return execFileAsync(file, args, { cwd: projectDir, maxBuffer, ...(timeout ? { timeout, killSignal: "SIGTERM" } : {}) });
}

function metadataToInventory(metadata: any): BlackRoomInventoryVideo {
  return {
    id: String(metadata?.id || ""),
    title: String(metadata?.title || "BlackRoom DJ Set"),
    duration: Number(metadata?.duration || 0),
    url: String(metadata?.webpage_url || metadata?.url || ""),
  };
}

function assertOwnedBlackRoomSource(metadata: any): void {
  if (!isOwnedBlackRoomMetadata(metadata)) {
    throw new Error("The selected YouTube video does not belong to @blackroom_us");
  }
}

async function loadMetadata(url: string): Promise<any> {
  const { stdout } = await run(ytDlpPath, [...ytDlpAuthArgs, "--skip-download", "--dump-single-json", "--no-warnings", "--no-playlist", url]);
  return JSON.parse(stdout);
}

async function loadChannelInventory(): Promise<BlackRoomInventoryVideo[]> {
  const { stdout } = await run(ytDlpPath, [...ytDlpAuthArgs, "--flat-playlist", "--dump-single-json", "--no-warnings", BLACKROOM_CHANNEL_VIDEOS_URL]);
  const inventory = JSON.parse(stdout);
  return (Array.isArray(inventory?.entries) ? inventory.entries : [])
    .map(metadataToInventory)
    .filter((video: BlackRoomInventoryVideo) => /\bDJ Set\b/i.test(video.title));
}

async function loadInventory(queue: BlackRoomQueueState): Promise<{ inventory: BlackRoomInventoryVideo[]; priorityVideoId: string | null }> {
  const priority = queue.prioritySources.find((source) => source.status === "pending");
  if (priority) {
    try {
      const metadata = await loadMetadata(priority.url);
      assertOwnedBlackRoomSource(metadata);
      const inventory = await loadChannelInventory();
      const priorityVideo = metadataToInventory(metadata);
      return { inventory: [priorityVideo, ...inventory.filter((video) => video.id !== priorityVideo.id)], priorityVideoId: priorityVideo.id };
    } catch (error) {
      await appendActivity(`La URL prioritaria no es elegible y se continuará con el canal: ${error instanceof Error ? error.message : String(error)}`, "fuente");
    }
  }
  return { inventory: await loadChannelInventory(), priorityVideoId: null };
}

function mediaStem(plan: BlackRoomEditPlan): string {
  const safeSlot = plan.slot.replace(":", "");
  return `${plan.jobId}_${safeSlot}_${plan.videoId}_${plan.format}_${plan.durationSeconds}s`.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

async function downloadWindow(plan: BlackRoomEditPlan, sourcePath: string, temporaryDirectory: string): Promise<void> {
  await appendActivity(`Descargando una ventana parcial de ${plan.dj} en 1080p con audio.`, "descarga");
  await downloadBlackRoomWindowWithFallback(plan, sourcePath, temporaryDirectory, ytDlpAuthArgs,
    (args) => run(ytDlpPath, args, 128 * 1024 * 1024, ytDlpTimeoutMs));
  const info = await stat(sourcePath);
  if (!info.isFile() || info.size <= 0) throw new Error("yt-dlp produced an empty BlackRoom source window");
}

async function deferFailedDownload(plan: BlackRoomEditPlan, error: unknown): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error);
  await withBlackRoomQueueLock(queuePath, async () => {
    const latest = await readBlackRoomQueue(queuePath);
    recordBlackRoomFailedSource(latest, plan.videoId, reason);
    await writeBlackRoomQueue(latest, queuePath);
  });
  await appendActivity(
    `La fuente ${plan.videoId} falló al descargar y queda excluida temporalmente; el siguiente intento elegirá otro DJ/video.`,
    "fuente",
    "error",
  );
}

async function analyzeDrop(sourcePath: string, plan: BlackRoomEditPlan): Promise<number> {
  await appendActivity("Analizando la energía del audio para colocar el drop cerca del inicio.", "audio");
  const { stderr } = await run(ffmpegPath, [
    "-nostdin", "-hide_banner", "-i", sourcePath, "-vn",
    "-af", "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
    "-f", "null", "-",
  ]);
  const samples = parseBlackRoomEnergySamples(stderr);
  return findBlackRoomDropOffset(samples, plan.durationSeconds, plan.windowEndSeconds - plan.windowStartSeconds, plan.creativeStrategy);
}

async function renderClip(sourcePath: string, renderPath: string, plan: BlackRoomEditPlan, offsetSeconds: number): Promise<void> {
  await appendActivity(`Renderizando ${plan.durationSeconds}s en formato ${plan.format}, técnica ${plan.creativeStrategy}, H.264 y AAC.`, "render");
  try {
    await run(ffmpegPath, buildBlackRoomRenderArgs(sourcePath, renderPath, plan, offsetSeconds), 128 * 1024 * 1024);
  } catch {
    await unlink(renderPath).catch(() => undefined);
    await run(ffmpegPath, buildBlackRoomRenderArgs(sourcePath, renderPath, plan, offsetSeconds, "libx264"), 128 * 1024 * 1024);
  }
}

async function validateRender(renderPath: string, plan: BlackRoomEditPlan): Promise<void> {
  const info = await stat(renderPath);
  if (!info.isFile() || info.size <= 0 || info.size > 500 * 1024 * 1024) throw new Error("BlackRoom render is empty or exceeds 500 MB");
  const { stdout } = await run(ffprobePath, [
    "-v", "error", "-show_entries", BLACKROOM_FFPROBE_SHOW_ENTRIES, "-of", "json", renderPath,
  ]);
  validateBlackRoomRenderProbe(JSON.parse(stdout), plan.durationSeconds);
  const { stderr } = await run(ffmpegPath, [
    "-nostdin", "-hide_banner", "-i", renderPath, "-map", "0:a:0", "-af", "volumedetect",
    "-vn", "-sn", "-dn", "-f", "null", "-",
  ]);
  validateBlackRoomAudioLoudness(stderr);
  await appendActivity("Video y audio validados correctamente; preparando la reserva.", "validación", "success");
}

async function cleanupUnreservedGeneratedMedia(ledger: BlackRoomWorkerLedger): Promise<void> {
  const referenced = new Set(ledger.entries.flatMap((entry) => [path.resolve(entry.sourcePath), path.resolve(entry.renderPath)]));
  for (const directory of [sourceDir, renderDir]) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (!item.isFile() || !item.name.startsWith("blackroom-tiktok-") || !item.name.endsWith(".mp4")) continue;
      const filePath = path.resolve(directory, item.name);
      if (!referenced.has(filePath)) await unlink(filePath).catch(() => undefined);
    }
  }
}

async function reserve(
  plan: BlackRoomEditPlan,
  sourcePath: string,
  renderPath: string,
  offsetSeconds: number,
  beginPreservingMedia: () => void,
  confirmReservation: () => void,
): Promise<void> {
  const queue = await readJson<BlackRoomQueueState>(queuePath);
  if (!isBlackRoomJobPublishable(queue, plan.jobId)) throw new Error("BlackRoom was paused before reservation");
  const segmentStart = plan.windowStartSeconds + offsetSeconds;
  const segmentEnd = segmentStart + plan.durationSeconds;
  await commitBlackRoomReservation(
    async () => {
      await run(npmPath, [
        "run", "blackroom:ledger", "--", "--reserve",
        "--job", plan.jobId, "--slot", plan.slot, "--video", plan.videoId, "--source-title", plan.title, "--dj", plan.dj,
        "--language", plan.language, "--format", plan.format, "--duration", String(plan.durationSeconds),
        "--networks", plan.targetNetworks.join(","),
        "--creative-strategy", plan.creativeStrategy,
        "--drop-offset", String(offsetSeconds), "--hook-family", plan.hookFamily,
        "--caption-variant", plan.captionVariant, "--creative-arm-id", plan.creativeArmId,
        ...(plan.learningTestId ? ["--learning-test-id", plan.learningTestId, "--learning-reference", plan.learningReference || "", "--learning-decisions", plan.learningDecisionIds || ""] : []),
        "--allocation-mode", plan.allocationMode,
        "--segment-start", String(segmentStart), "--segment-end", String(segmentEnd), "--caption", plan.caption,
        "--render", renderPath, "--source", sourcePath,
      ]);
    },
    beginPreservingMedia,
    confirmReservation,
    () => appendActivity(`Clip reservado sin IA: ${plan.dj}, ${plan.durationSeconds}s, ${plan.format}, técnica ${plan.creativeStrategy}, ${plan.slot}.`, "reserva", "success"),
  );
}

async function main(): Promise<void> {
  await mkdir(sourceDir, { recursive: true });
  await mkdir(renderDir, { recursive: true });
  await rm(editorTemporaryRoot, { recursive: true, force: true });
  const ledger = await readJson<BlackRoomWorkerLedger>(ledgerPath).catch((): BlackRoomWorkerLedger => ({ version: 1, entries: [] }));
  await cleanupUnreservedGeneratedMedia(ledger);
  const queue = await readJson<BlackRoomQueueState>(queuePath);
  if (queue.enabled !== true) return;
  const localReport = await readJson<any>(path.join(path.dirname(ledgerPath), "local-ceo-report.json")).catch(() => null);
  if (localReport?.scope === "local-evidence" && localReport.version === 1 && queue.analytics?.verifiedLearning) {
    // Only this edit plan sees the overlay. No local recommendation mutates
    // the remote queue or authorizes a schedule, upload, or cleanup.
    queue.analytics = applyLocalEditorialReport(queue.analytics, localReport, new Date());
  }
  const sources = await loadInventory(queue);
  const plan = planBlackRoomDeterministicEdit({ queue, ledger, ...sources });
  if (!plan) return;
  if (sources.priorityVideoId && plan.videoId !== sources.priorityVideoId) {
    await appendActivity("La URL prioritaria ya fue usada, no soporta esta duración o no corresponde a los cinco DJs del lote; se eligió otra fuente sin detener la cola.", "fuente");
  }
  const metadata = await loadMetadata(plan.videoUrl);
  assertOwnedBlackRoomSource(metadata);
  if (String(metadata.id || "") !== plan.videoId) throw new Error("YouTube metadata changed during BlackRoom selection");
  const stem = mediaStem(plan);
  const sourcePath = path.join(sourceDir, `${stem}_source.mp4`);
  const renderPath = path.join(renderDir, `${stem}.mp4`);
  const temporaryDirectory = path.join(editorTemporaryRoot, stem);
  await mkdir(temporaryDirectory, { recursive: true });
  let reservationState: "unreserved" | "committing" | "reserved" = "unreserved";
  const cleanup = async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
    if (reservationState === "unreserved") {
      await unlink(renderPath).catch(() => undefined);
      await unlink(sourcePath).catch(() => undefined);
      await unlink(`${sourcePath}.part`).catch(() => undefined);
    }
  };
  activeCleanup = cleanup;
  try {
    try {
      await downloadWindow(plan, sourcePath, temporaryDirectory);
    } catch (error) {
      await deferFailedDownload(plan, error).catch(() => undefined);
      throw error;
    }
    const offsetSeconds = await analyzeDrop(sourcePath, plan);
    await renderClip(sourcePath, renderPath, plan, offsetSeconds);
    await validateRender(renderPath, plan);
    await reserve(
      plan,
      sourcePath,
      renderPath,
      offsetSeconds,
      () => { reservationState = "committing"; },
      () => { reservationState = "reserved"; },
    );
  } finally {
    await cleanup();
    activeCleanup = null;
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void (activeCleanup?.() || Promise.resolve()).finally(() => process.exit(0));
  });
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  await appendActivity(`Error del editor local: ${message}`, "error", "error").catch(() => undefined);
  console.error(message);
  process.exitCode = 1;
});
