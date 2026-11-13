import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  BLACKROOM_WORKER_LOCK_PATH,
  BLACKROOM_WORKER_STATE_PATH,
  buildBlackRoomLocalEditorArgs,
  createBlackRoomLocalWorkerState,
  resolveBlackRoomPublicationDateTime,
  isBlackRoomJobPublishable,
  selectPublishableBlackRoomReservation,
  shouldRunBlackRoomWorker,
  validateBlackRoomRenderProbe,
  validateBlackRoomAudioLoudness,
  hasCompleteBlackRoomMetricoolReceipt,
  requiredBlackRoomReceiptNetworks,
  buildBlackRoomUploadChunks,
  blackRoomEditorExitMessage,
  isBlackRoomSourceSegmentRecorded,
  BLACKROOM_FFPROBE_SHOW_ENTRIES,
  type BlackRoomLocalWorkerState,
  type BlackRoomLedgerEntry,
} from "../server/blackroom-local-worker";
import { BLACKROOM_QUEUE_PATH } from "../server/blackroom-daily-queue";

const projectDir = path.resolve(process.env.BLACKROOM_PROJECT_DIR || process.cwd());
const queuePath = path.join(projectDir, process.env.BLACKROOM_QUEUE_PATH || BLACKROOM_QUEUE_PATH);
const ledgerPath = path.join(projectDir, "clippers_workspace/blackroom/agent/worker-ledger.json");
const statePath = path.join(projectDir, BLACKROOM_WORKER_STATE_PATH);
const lockPath = path.join(projectDir, BLACKROOM_WORKER_LOCK_PATH);
const logPath = path.join(projectDir, "clippers_workspace/blackroom/agent/worker.log");
const activityPath = path.join(projectDir, "clippers_workspace/blackroom/agent/activity-log.json");
const nodePath = process.env.BLACKROOM_NODE_PATH || process.execPath;
const pollMs = Math.max(5_000, Number(process.env.BLACKROOM_WORKER_POLL_MS || 15_000));
const maxRunMs = Math.max(60_000, Number(process.env.BLACKROOM_WORKER_MAX_RUN_MS || 45 * 60_000));
const remoteUrl = String(process.env.BLACKROOM_REMOTE_CONTROL_URL || "https://robplanner.replit.app").replace(/\/$/, "");
const remoteToken = String(process.env.BLACKROOM_REMOTE_CONTROL_TOKEN || "").trim();
const execFileAsync = promisify(execFile);
let activeChild: ReturnType<typeof spawn> | null = null;
let stopping = false;

class BlackRoomPublishPausedError extends Error {}

function waitForChildExit(child: ReturnType<typeof spawn>): Promise<number> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode ?? 1);
  return new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function terminateChildGroup(child: ReturnType<typeof spawn>, graceMs = 5_000): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  const exitPromise = waitForChildExit(child);
  try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
  const ended = await Promise.race([
    exitPromise.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), graceMs)),
  ]);
  if (ended) return;
  try { process.kill(-child.pid, "SIGKILL"); } catch { return; }
  await exitPromise;
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(filePath, "utf8")); }
  catch (error: any) { if (error?.code === "ENOENT") return fallback; throw error; }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

async function appendLog(message: string, stage = "sistema", level: "info" | "success" | "error" = "info"): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  const createdAt = new Date().toISOString();
  const handle = await open(logPath, "a");
  try { await handle.write(`${createdAt} ${message}\n`); }
  finally { await handle.close(); }
  try {
    const activity = await readJson<any[]>(activityPath, []);
    activity.push({ id: `${createdAt}-${stage}`, createdAt, stage, level, message: message.slice(0, 1_000) });
    await writeJson(activityPath, activity.slice(-80));
  } catch { /* activity visibility must never stop publishing */ }
}

async function runNpm(args: string[]): Promise<void> {
  await execFileAsync(process.env.BLACKROOM_NPM_PATH || "npm", args, { cwd: projectDir, maxBuffer: 4_000_000 });
}

async function remoteJson(url: string, init: RequestInit & { duplex?: "half" }, timeoutMs = 180_000): Promise<any> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `BlackRoom bridge returned HTTP ${response.status}`) as Error & { uncertain?: boolean; retainAttempt?: boolean; definitelyNotSubmitted?: boolean };
    error.uncertain = data.uncertain === true;
    error.retainAttempt = data.retainAttempt === true;
    error.definitelyNotSubmitted = response.status === 423 && data.blocked === true
      && data.retainAttempt === true && data.definitelyNotSubmitted === true;
    throw error;
  }
  return data;
}

async function fileExists(filePath: string): Promise<boolean> {
  return Boolean((await stat(filePath).catch(() => null))?.isFile());
}

async function ensureSourceRecorded(entry: any): Promise<void> {
  const queue = await readJson<any>(queuePath, { sourceHistory: [] });
  if (isBlackRoomSourceSegmentRecorded(queue.sourceHistory || [], entry)) return;
  await runNpm(["run", "blackroom:agent", "--", "--record-source", "--video", entry.videoId, "--job", entry.jobId,
    "--dj", entry.dj, "--format", entry.format, "--language", entry.language, "--duration", String(entry.durationSeconds),
    "--start-second", String(entry.segmentStartSeconds), "--end-second", String(entry.segmentEndSeconds)]);
}

async function deleteConfirmedMedia(entry: any): Promise<void> {
  for (const filePath of [entry.renderPath, entry.sourcePath]) {
    if (!filePath || !(await fileExists(filePath))) continue;
    await runNpm(["run", "blackroom:ledger", "--", "--delete-confirmed", "--reservation", entry.reservationId, "--file", filePath]);
  }
}

async function recoverConfirmedCleanup(): Promise<void> {
  const ledger = await readJson<any>(ledgerPath, { entries: [] });
  for (const entry of ledger.entries || []) {
    if (entry.status !== "confirmed" || !hasCompleteBlackRoomMetricoolReceipt(entry)) continue;
    await ensureSourceRecorded(entry);
    await deleteConfirmedMedia(entry);
  }
}

async function uploadBlackRoomRender(entry: any, renderSize: number): Promise<{ uploadId: string; mediaUrl: string }> {
  const chunks = buildBlackRoomUploadChunks(renderSize);
  const initialized = await remoteJson(`${remoteUrl}/api/blackroom-agent/media/chunked`, {
    method: "POST",
    headers: { Authorization: `Bearer ${remoteToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reservationId: entry.reservationId, totalBytes: renderSize, totalChunks: chunks.length }),
  });
  for (const chunk of chunks) {
    await remoteJson(`${remoteUrl}/api/blackroom-agent/media/chunked/${encodeURIComponent(initialized.uploadId)}/${chunk.index}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${remoteToken}`,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(chunk.size),
      },
      body: createReadStream(entry.renderPath, { start: chunk.start, end: chunk.end }) as any,
      duplex: "half",
    }, 5 * 60_000);
  }
  return remoteJson(`${remoteUrl}/api/blackroom-agent/media/chunked/${encodeURIComponent(initialized.uploadId)}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${remoteToken}`, "Content-Type": "application/json" },
    body: "{}",
  });
}

async function publishOneReservedEntry(): Promise<boolean> {
  if (!remoteToken || remoteToken.length < 32) throw new Error("BLACKROOM_REMOTE_CONTROL_TOKEN is required for Metricool publishing");
  const queue = await readJson<any>(queuePath, {});
  if (queue.enabled !== true) return false;
  await recoverConfirmedCleanup();
  const ledger = await readJson<{ entries: BlackRoomLedgerEntry[] }>(ledgerPath, { entries: [] });
  const entry = selectPublishableBlackRoomReservation(queue, ledger.entries || []);
  if (!entry) return false;
  await appendLog(`Preparando el clip ${entry.reservationId} para validación y publicación.`, "preparación");
  const renderInfo = await stat(entry.renderPath).catch(() => null);
  if (!renderInfo?.isFile() || renderInfo.size <= 0 || renderInfo.size > 500 * 1024 * 1024) {
    const safeToDiscard = entry.status === "reserved"
      && !Object.keys(entry.networkAttempts || {}).length
      && !Object.keys(entry.networkReceipts || {}).length
      && !entry.metricoolId;
    if (!safeToDiscard) throw new Error(`Reserved render is missing or too large: ${entry.reservationId}`);
    await runNpm(["run", "blackroom:ledger", "--", "--discard-unpublished", "--reservation", entry.reservationId]);
    await appendLog(`Reserva local sin archivo descartada de forma segura: ${entry.reservationId}. Se continuará con un clip nuevo.`, "recuperación", "error");
    return false;
  }
  const { stdout: probeOutput } = await execFileAsync(process.env.BLACKROOM_FFPROBE_PATH || "/opt/homebrew/bin/ffprobe", [
    "-v", "error", "-show_entries", BLACKROOM_FFPROBE_SHOW_ENTRIES, "-of", "json", entry.renderPath,
  ], { maxBuffer: 4_000_000 });
  validateBlackRoomRenderProbe(JSON.parse(probeOutput), Number(entry.durationSeconds));
  await appendLog(`Video validado: H.264, duración ${entry.durationSeconds}s y formato ${entry.format}.`, "video", "success");
  const { stderr: loudnessOutput } = await execFileAsync(process.env.BLACKROOM_FFMPEG_PATH || "/opt/homebrew/bin/ffmpeg", [
    "-nostdin", "-hide_banner", "-i", entry.renderPath, "-map", "0:a:0", "-af", "volumedetect", "-vn", "-sn", "-dn", "-f", "null", "-",
  ], { maxBuffer: 8_000_000 });
  const loudness = validateBlackRoomAudioLoudness(loudnessOutput);
  await appendLog(`Audio validado para ${entry.reservationId}: promedio ${loudness.meanVolumeDb.toFixed(1)} dB, máximo ${loudness.maxVolumeDb.toFixed(1)} dB.`, "audio", "success");
  const job = (queue.jobs || []).find((candidate: any) => candidate.id === entry.jobId);
  if (!job) throw new Error(`Queue job not found for ${entry.reservationId}`);
  const publicationDateTime = resolveBlackRoomPublicationDateTime(
    entry,
    job,
    queue.timezone || "America/New_York",
  );
  entry.networkAttempts ||= {};
  entry.networkReceipts ||= {};
  const networks = requiredBlackRoomReceiptNetworks(entry);
  // A legacy whole-reservation uncertainty has no per-network state. Treat every
  // required network as verification-only so an upgrade can never duplicate it.
  if (entry.status === "uncertain" && !Object.keys(entry.networkAttempts).length) {
    for (const network of networks) entry.networkAttempts[network] = "uncertain";
  }
  for (const network of networks) {
    if (entry.networkReceipts[network]) continue;
    const verifyOnly = entry.networkAttempts[network] === "uncertain";
    await appendLog(`${verifyOnly ? "Verificando" : "Subiendo y programando"} ${network} para ${publicationDateTime}.`, network);
    const upload = verifyOnly ? null : await uploadBlackRoomRender(entry, renderInfo.size);
    const preScheduleQueue = await readJson<any>(queuePath, {});
    if (!isBlackRoomJobPublishable(preScheduleQueue, entry.jobId)) {
      throw new BlackRoomPublishPausedError(`BlackRoom paused before Metricool scheduling for ${entry.reservationId}`);
    }
    if (!verifyOnly) {
      // Persist intent for this exact network before its POST. A crash may leave
      // only this network uncertain; later networks remain safely not_attempted.
      await runNpm(["run", "blackroom:ledger", "--", "--network-uncertain", "--reservation", entry.reservationId,
        "--network", network, "--publication-date-time", publicationDateTime]);
      entry.networkAttempts[network] = "uncertain";
      entry.publicationDateTime = publicationDateTime;
    }
    let scheduled: any;
    try {
      scheduled = await remoteJson(`${remoteUrl}/api/blackroom-agent/metricool/schedule`, {
        method: "POST",
        headers: { Authorization: `Bearer ${remoteToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(upload ? { uploadId: upload.uploadId } : {}),
          verifyOnly,
          network,
          reservationId: entry.reservationId,
          jobId: entry.jobId,
          caption: entry.caption,
          language: entry.language,
          sourceVideoId: entry.videoId,
          dj: entry.dj,
          durationSeconds: entry.durationSeconds,
          videoFormat: entry.format,
          creativeStrategy: entry.creativeStrategy || "drop_first",
          publicationDateTime,
          timezone: queue.timezone || "America/New_York",
        }),
      });
    } catch (error) {
      if (!verifyOnly && (error as { definitelyNotSubmitted?: boolean })?.definitelyNotSubmitted === true) {
        // Persist proof of a pre-dispatch veto, not a reset. An already-uncertain
        // invocation is verification-only and can never be downgraded here.
        await runNpm(["run", "blackroom:ledger", "--", "--network-blocked", "--reservation", entry.reservationId,
          "--network", network]);
        entry.networkAttempts[network] = "blocked";
      }
      // Transport loss/unknown 5xx may follow acceptance: never auto-reset.
      throw error;
    }
    const networkId = String(scheduled?.receipt?.platformReceipts?.[network] || scheduled?.receipt?.metricoolId || "").trim();
    if (!scheduled?.receipt?.verified || !networkId) throw new Error(`Metricool bridge returned no verified ${network} receipt`);
    await runNpm(["run", "blackroom:ledger", "--", "--network-confirm", "--reservation", entry.reservationId,
      "--network", network, "--metricool-id", networkId]);
    entry.networkAttempts[network] = "confirmed";
    entry.networkReceipts[network] = networkId;
    await appendLog(`${network} confirmado por Metricool.`, network, "success");
  }
  if (networks.some((network) => !String(entry.networkReceipts[network] || "").trim())) {
    throw new Error("BlackRoom is missing one or more required Metricool receipts");
  }
  const combinedMetricoolId = networks.map((network) => `${network}:${entry.networkReceipts[network]}`).join("|");
  const confirmedDestinations = networks.join(", ");
  await runNpm(["run", "blackroom:ledger", "--", "--confirm", "--reservation", entry.reservationId, "--metricool-id", combinedMetricoolId]);
  const postScheduleQueue = await readJson<any>(queuePath, {});
  if (!isBlackRoomJobPublishable(postScheduleQueue, entry.jobId)) {
    await appendLog(`${confirmedDestinations} confirmados para ${entry.reservationId}; limpieza pospuesta porque el agente está pausado.`, "limpieza", "success");
    return true;
  }
  await ensureSourceRecorded(entry);
  await deleteConfirmedMedia(entry);
  const refreshedLedger = await readJson<any>(ledgerPath, { entries: [] });
  const confirmed = (refreshedLedger.entries || []).filter((candidate: any) => candidate.jobId === entry.jobId && candidate.status === "confirmed");
  if (confirmed.length >= Number(job.requirements?.posts || 5)) await runNpm(["run", "blackroom:agent", "--", "--complete", "--job", entry.jobId]);
  await appendLog(`${confirmedDestinations} confirmados para ${entry.reservationId}; archivo local eliminado.`, "completado", "success");
  return true;
}

async function runLocalEditor(state: BlackRoomLocalWorkerState): Promise<void> {
  const startedAt = new Date().toISOString();
  Object.assign(state, { running: true, pid: null, startedAt, finishedAt: null, lastError: null, runs: state.runs + 1 });
  await writeJson(statePath, state);
  await appendLog("Iniciando descarga, selección del drop y edición de un nuevo clip.", "edición");

  const output = await open(logPath, "a");
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const child = spawn(nodePath, buildBlackRoomLocalEditorArgs(projectDir), {
      cwd: projectDir, detached: true, stdio: ["ignore", output.fd, output.fd],
    });
    activeChild = child;
    state.pid = child.pid || null;
    await writeJson(statePath, state);
    const exitPromise = waitForChildExit(child);
    const outcome = await Promise.race([
      exitPromise.then((exitCode) => ({ timedOut: false as const, exitCode })),
      new Promise<{ timedOut: true; exitCode: 124 }>((resolve) => {
        timeout = setTimeout(() => resolve({ timedOut: true, exitCode: 124 }), maxRunMs);
      }),
    ]);
    if (outcome.timedOut) await terminateChildGroup(child);
    const exitCode = outcome.exitCode;
    clearTimeout(timeout);
    timeout = null;
    Object.assign(state, { running: false, pid: null, finishedAt: new Date().toISOString(), lastExitCode: exitCode });
    if (exitCode !== 0) state.lastError = `El editor local terminó con código ${exitCode}`;
    else {
      const latestQueue = await readJson<any>(queuePath, { enabled: false });
      const completion = blackRoomEditorExitMessage(latestQueue.enabled === true);
      await appendLog(completion.message, "edición", completion.level);
    }
  } catch (error) {
    Object.assign(state, { running: false, pid: null, finishedAt: new Date().toISOString(), lastExitCode: 1, lastError: error instanceof Error ? error.message : String(error) });
  } finally {
    if (timeout) clearTimeout(timeout);
    activeChild = null;
    await output.close();
    await writeJson(statePath, state);
  }
}

async function main(): Promise<void> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  let lock;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lock = await open(lockPath, "wx");
      await lock.write(String(process.pid));
      break;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      const existingPid = Number((await readFile(lockPath, "utf8").catch(() => "0")).trim());
      let alive = false;
      if (Number.isInteger(existingPid) && existingPid > 0) {
        try { process.kill(existingPid, 0); alive = true; } catch { alive = false; }
      } else {
        const lockStat = await stat(lockPath).catch(() => null);
        alive = Boolean(lockStat && Date.now() - lockStat.mtimeMs < 30_000);
      }
      if (alive || attempt > 0) return;
      await unlink(lockPath).catch(() => undefined);
    }
  }
  if (!lock) return;
  const state = await readJson(statePath, createBlackRoomLocalWorkerState());
  state.workerPid = process.pid;
  await writeJson(statePath, state);
  const stop = async (interrupted = false) => {
    if (stopping) return;
    stopping = true;
    if (activeChild?.pid) {
      await terminateChildGroup(activeChild);
    }
    state.workerPid = null;
    if (interrupted) Object.assign(state, { running: false, pid: null, finishedAt: new Date().toISOString(), lastError: "Pausado por el usuario" });
    await writeJson(statePath, state).catch(() => undefined);
    await lock.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  };
  process.once("SIGTERM", () => void stop(true).finally(() => process.exit(0)));
  process.once("SIGINT", () => void stop(true).finally(() => process.exit(0)));
  try {
    while (true) {
      const queue = await readJson<{ enabled?: boolean; jobs?: Array<{ status?: string; notBefore?: string }> }>(queuePath, {});
      if (!shouldRunBlackRoomWorker(queue)) break;
      try {
        const publishedExisting = await publishOneReservedEntry();
        if (!publishedExisting) {
          await runLocalEditor(state);
          const publishedNew = await publishOneReservedEntry();
          if (!publishedNew) throw new Error(state.lastError || "El editor local terminó sin reservar un video de BlackRoom");
        }
        state.lastError = null;
        await writeJson(statePath, state);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state.lastError = message;
        await appendLog(`Error del publicador: ${message}`, "error", "error");
        await writeJson(statePath, state);
        if (error instanceof BlackRoomPublishPausedError) continue;
        const ledger = await readJson<any>(ledgerPath, { entries: [] });
        const reserved = (ledger.entries || []).find((candidate: any) => candidate.status === "reserved");
        if (reserved?.jobId) await runNpm(["run", "blackroom:agent", "--", "--retry", "--job", reserved.jobId, "--error", message]).catch(() => undefined);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } finally { await stop(false); }
}

main().catch(async (error) => {
  await appendLog(`Error fatal: ${error instanceof Error ? error.message : String(error)}`, "error", "error").catch(() => undefined);
  process.exitCode = 1;
});
