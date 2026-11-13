import { realpathSync } from "node:fs";
import path from "node:path";

export const BLACKROOM_WORKER_STATE_PATH = "clippers_workspace/blackroom/agent/worker-state.json";
export const BLACKROOM_WORKER_LEDGER_PATH = "clippers_workspace/blackroom/agent/worker-ledger.json";
export const BLACKROOM_WORKER_LOCK_PATH = "clippers_workspace/blackroom/agent/worker.lock";

export interface BlackRoomLocalWorkerState {
  running: boolean;
  workerPid: number | null;
  pid: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastExitCode: number | null;
  lastError: string | null;
  runs: number;
}

export const BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
export const BLACKROOM_FFPROBE_SHOW_ENTRIES = "format=format_name,duration:stream=codec_type,codec_name,width,height,pix_fmt,duration,channels";

export function isBlackRoomSourceSegmentRecorded(
  sourceHistory: Array<{ videoId?: string; segmentStartSeconds?: number; segmentEndSeconds?: number }>,
  entry: Pick<BlackRoomLedgerEntry, "videoId" | "segmentStartSeconds" | "segmentEndSeconds">,
): boolean {
  return sourceHistory.some((candidate) => candidate.videoId === entry.videoId
    && candidate.segmentStartSeconds === entry.segmentStartSeconds
    && candidate.segmentEndSeconds === entry.segmentEndSeconds);
}

export function blackRoomEditorExitMessage(queueEnabled: boolean): { message: string; level: "info" | "success" } {
  return queueEnabled
    ? { message: "Descarga y edición terminadas; buscando el clip reservado para publicarlo.", level: "success" }
    : { message: "Edición detenida por pausa; no se iniciarán nuevos clips.", level: "info" };
}

export function buildBlackRoomUploadChunks(totalBytes: number, chunkBytes = BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES): Array<{ index: number; start: number; end: number; size: number }> {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0 || !Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw new Error("Invalid BlackRoom upload size");
  const chunks: Array<{ index: number; start: number; end: number; size: number }> = [];
  for (let start = 0, index = 0; start < totalBytes; start += chunkBytes, index += 1) {
    const end = Math.min(totalBytes - 1, start + chunkBytes - 1);
    chunks.push({ index, start, end, size: end - start + 1 });
  }
  return chunks;
}

export type BlackRoomLedgerStatus = "reserved" | "confirmed" | "uncertain" | "discarded";
export type BlackRoomReceiptNetwork = "tiktok" | "facebook" | "youtube";
export type BlackRoomNetworkAttemptStatus = "blocked" | "uncertain" | "confirmed";

function isValidBlackRoomPublicationDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value;
}

export interface BlackRoomLedgerEntry {
  reservationId: string;
  jobId: string;
  targetNetworks?: BlackRoomReceiptNetwork[];
  slot: string;
  videoId: string;
  sourceVideoTitle?: string;
  dj: string;
  language: "en" | "es";
  format: "vertical" | "horizontal";
  durationSeconds: 15 | 30 | 60 | 120 | 300 | 600;
  segmentStartSeconds: number;
  segmentEndSeconds: number;
  caption: string;
  creativeStrategy?: import("./blackroom-growth-ceo").BlackRoomCreativeStrategy;
  dropOffsetSeconds?: number;
  hookFamily?: string;
  captionVariant?: string;
  creativeArmId?: string;
  learningTestId?: string;
  learningReference?: string;
  learningDecisionIds?: string;
  allocationMode?: "exploit" | "explore";
  renderPath: string;
  sourcePath: string;
  status: BlackRoomLedgerStatus;
  metricoolId: string | null;
  publicationDateTime: string | null;
  networkAttempts: Partial<Record<BlackRoomReceiptNetwork, BlackRoomNetworkAttemptStatus>>;
  networkReceipts: Partial<Record<BlackRoomReceiptNetwork, string>>;
  createdAt: string;
  updatedAt: string;
}

export interface BlackRoomWorkerLedger { version: 1; entries: BlackRoomLedgerEntry[] }

export function requiredBlackRoomReceiptNetworks(
  entry: Pick<BlackRoomLedgerEntry, "format" | "durationSeconds" | "targetNetworks">,
): Array<"tiktok" | "facebook" | "youtube"> {
  const eligible: Array<"tiktok" | "facebook" | "youtube"> = ["tiktok", "facebook"];
  if (entry.format === "vertical" && entry.durationSeconds >= 3 && entry.durationSeconds <= 178) eligible.push("youtube");
  if (entry.targetNetworks?.length) {
    const requested = [...new Set(entry.targetNetworks)];
    if (requested.some((network) => !eligible.includes(network))) {
      throw new Error("BlackRoom target network is incompatible with the rendered clip");
    }
    return requested;
  }
  return eligible;
}

export function hasCompleteBlackRoomMetricoolReceipt(
  entry: Pick<BlackRoomLedgerEntry, "format" | "durationSeconds" | "targetNetworks" | "metricoolId">,
): boolean {
  const receipts = new Map<string, string>();
  for (const part of String(entry.metricoolId || "").split("|")) {
    const match = part.match(/^(tiktok|facebook|youtube):([^|\s]+)$/);
    if (match) receipts.set(match[1], match[2]);
  }
  return requiredBlackRoomReceiptNetworks(entry).every((network) => Boolean(receipts.get(network)));
}

export function markBlackRoomNetworkUncertain(
  entry: BlackRoomLedgerEntry,
  network: BlackRoomReceiptNetwork,
  publicationDateTime: string,
): BlackRoomLedgerEntry {
  if (entry.status === "confirmed") throw new Error("confirmed reservation is immutable");
  if (!isValidBlackRoomPublicationDateTime(publicationDateTime)) throw new Error("invalid Metricool publication date");
  entry.networkAttempts ||= {};
  entry.networkReceipts ||= {};
  entry.networkAttempts[network] = "uncertain";
  entry.publicationDateTime = publicationDateTime;
  entry.updatedAt = new Date().toISOString();
  return entry;
}

/** A positively acknowledged pre-dispatch veto is not a reset or uncertainty.
 * The caller must never downgrade a verification-only/previously unknown POST.
 */
export function markBlackRoomNetworkBlocked(
  entry: BlackRoomLedgerEntry, network: BlackRoomReceiptNetwork, now = new Date(),
): BlackRoomLedgerEntry {
  if (entry.status === "confirmed" || entry.networkReceipts?.[network]) throw new Error("confirmed receipt is immutable");
  entry.networkAttempts ||= {};
  entry.networkAttempts[network] = "blocked";
  entry.updatedAt = now.toISOString();
  return entry;
}

export function confirmBlackRoomNetworkReceipt(
  entry: BlackRoomLedgerEntry,
  network: BlackRoomReceiptNetwork,
  metricoolId: string,
): BlackRoomLedgerEntry {
  if (entry.status === "confirmed") throw new Error("confirmed reservation is immutable");
  const id = metricoolId.trim();
  if (!id || /[|\s]/.test(id)) throw new Error("valid Metricool network receipt is required");
  entry.networkAttempts ||= {};
  entry.networkReceipts ||= {};
  entry.networkAttempts[network] = "confirmed";
  entry.networkReceipts[network] = id;
  entry.updatedAt = new Date().toISOString();
  return entry;
}

export function resetBlackRoomNetworkAttempt(
  entry: BlackRoomLedgerEntry,
  network: BlackRoomReceiptNetwork,
): BlackRoomLedgerEntry {
  if (entry.status === "confirmed") throw new Error("confirmed reservation is immutable");
  entry.networkAttempts ||= {};
  entry.networkReceipts ||= {};
  delete entry.networkAttempts[network];
  delete entry.networkReceipts[network];
  entry.updatedAt = new Date().toISOString();
  return entry;
}

export function createBlackRoomWorkerLedger(): BlackRoomWorkerLedger {
  return { version: 1, entries: [] };
}

export function createBlackRoomLocalWorkerState(): BlackRoomLocalWorkerState {
  return {
    running: false,
    workerPid: null,
    pid: null,
    startedAt: null,
    finishedAt: null,
    lastExitCode: null,
    lastError: null,
    runs: 0,
  };
}

export function buildBlackRoomLocalEditorArgs(projectDir: string): string[] {
  return [
    "--experimental-strip-types",
    "--import",
    path.join(projectDir, "script/register-native-typescript.mjs"),
    path.join(projectDir, "script/blackroom-deterministic-editor.ts"),
  ];
}

export function shouldRunBlackRoomWorker(
  queue: { enabled?: unknown; jobs?: Array<{ status?: string; notBefore?: string }> },
  now = new Date(),
): boolean {
  return queue.enabled === true && Array.isArray(queue.jobs)
    && queue.jobs.some((job) => ["queued", "retry", "processing"].includes(String(job.status || ""))
      && (!job.notBefore || new Date(job.notBefore).getTime() <= now.getTime()));
}

export function isBlackRoomJobPublishable(
  queue: { enabled?: unknown; jobs?: Array<{ id?: string; status?: string; notBefore?: string }> },
  jobId: string,
  now = new Date(),
): boolean {
  if (queue.enabled !== true) return false;
  const job = queue.jobs?.find((candidate) => candidate.id === jobId);
  return Boolean(job && ["queued", "retry", "processing"].includes(String(job.status || ""))
    && (!job.notBefore || new Date(job.notBefore).getTime() <= now.getTime()));
}

export function selectPublishableBlackRoomReservation<T extends { status?: string; jobId?: string; publicationDateTime?: string | null }>(
  queue: { enabled?: unknown; jobs?: Array<{ id?: string; status?: string; notBefore?: string }> },
  entries: T[],
  now = new Date(),
): T | null {
  const publishable = entries.filter((entry) => ["reserved", "uncertain"].includes(String(entry.status || ""))
    && isBlackRoomJobPublishable(queue, String(entry.jobId || ""), now));
  // An explicitly scheduled reservation is an owner-approved override and must
  // be processed before legacy unscheduled reservations. Stable index order is
  // preserved among entries with the same priority.
  return publishable.map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftDate = left.entry.publicationDateTime || "";
      const rightDate = right.entry.publicationDateTime || "";
      if (Boolean(leftDate) !== Boolean(rightDate)) return leftDate ? -1 : 1;
      return leftDate.localeCompare(rightDate) || left.index - right.index;
    })[0]?.entry || null;
}

function addUtcCalendarDay(date: string): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function blackRoomLocalWallClock(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:00`;
}

export function nextBlackRoomPublicationDateTime(
  targetDate: string,
  slot: string,
  timezone = "America/New_York",
  now = new Date(),
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !/^\d{2}:\d{2}$/.test(slot)) throw new Error("invalid BlackRoom target date or slot");
  const currentLocal = blackRoomLocalWallClock(now, timezone).slice(0, 16);
  let candidate = `${targetDate}T${slot}`;
  while (candidate <= currentLocal) candidate = `${addUtcCalendarDay(candidate.slice(0, 10))}T${slot}`;
  return `${candidate}:00`;
}

export function resolveBlackRoomPublicationDateTime(
  entry: {
    status?: string;
    slot?: string;
    publicationDateTime?: string | null;
    networkAttempts?: Record<string, unknown> | null;
    networkReceipts?: Record<string, unknown> | null;
  },
  job: { targetDate?: string },
  timezone = "America/New_York",
  now = new Date(),
): string {
  const persisted = String(entry.publicationDateTime || "");
  const hasNetworkEvidence = entry.status === "uncertain"
    || Object.keys(entry.networkAttempts || {}).length > 0
    || Object.keys(entry.networkReceipts || {}).length > 0;
  if (persisted && (hasNetworkEvidence || persisted > blackRoomLocalWallClock(now, timezone))) return persisted;
  return nextBlackRoomPublicationDateTime(String(job.targetDate || ""), String(entry.slot || ""), timezone, now);
}

export function validateBlackRoomRenderProbe(
  probe: { format?: { format_name?: string; duration?: string | number }; streams?: Array<Record<string, any>> },
  expectedDurationSeconds: number,
): { durationSeconds: number; width: number; height: number } {
  const formatName = String(probe.format?.format_name || "");
  const durationSeconds = Number(probe.format?.duration);
  const video = (probe.streams || []).find((stream) => stream.codec_type === "video");
  const audio = (probe.streams || []).find((stream) => stream.codec_type === "audio");
  const width = Number(video?.width);
  const height = Number(video?.height);
  if (!formatName.split(",").includes("mp4")) throw new Error("BlackRoom render is not an MP4");
  if (video?.codec_name !== "h264" || !["yuv420p", "yuvj420p"].includes(String(video?.pix_fmt || ""))) {
    throw new Error("BlackRoom render must use H.264 4:2:0 video");
  }
  if (audio?.codec_name !== "aac") throw new Error("BlackRoom render must use AAC audio");
  const audioDurationSeconds = Number(audio?.duration);
  const audioChannels = Number(audio?.channels);
  if (!Number.isFinite(audioDurationSeconds) || audioDurationSeconds < expectedDurationSeconds - 1 || !Number.isSafeInteger(audioChannels) || audioChannels < 1) {
    throw new Error("BlackRoom render audio track is missing, incomplete, or has no channels");
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || Math.min(width, height) < 540) {
    throw new Error("BlackRoom render resolution is below TikTok's 540 px minimum");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds < expectedDurationSeconds - 0.75 || durationSeconds > expectedDurationSeconds + 2) {
    throw new Error(`BlackRoom render duration does not match ${expectedDurationSeconds} seconds`);
  }
  return { durationSeconds, width, height };
}

export function validateBlackRoomAudioLoudness(output: string): { meanVolumeDb: number; maxVolumeDb: number } {
  const parseDb = (label: "mean_volume" | "max_volume") => {
    const value = output.match(new RegExp(`${label}:\\s*(-?inf|-?\\d+(?:\\.\\d+)?)\\s*dB`, "i"))?.[1];
    if (!value || /inf/i.test(value)) return Number.NEGATIVE_INFINITY;
    return Number(value);
  };
  const meanVolumeDb = parseDb("mean_volume");
  const maxVolumeDb = parseDb("max_volume");
  if (!Number.isFinite(meanVolumeDb) || !Number.isFinite(maxVolumeDb) || meanVolumeDb < -45 || maxVolumeDb < -30) {
    throw new Error("BlackRoom render audio is silent or below the audible-volume threshold");
  }
  return { meanVolumeDb, maxVolumeDb };
}

export function reserveBlackRoomLedgerEntry(
  ledger: BlackRoomWorkerLedger,
  input: Omit<BlackRoomLedgerEntry, "reservationId" | "status" | "metricoolId" | "publicationDateTime" | "networkAttempts" | "networkReceipts" | "createdAt" | "updatedAt">,
  sourceHistory: Iterable<{ videoId: string; segmentStartSeconds: number; segmentEndSeconds: number }> = [],
  now = new Date(),
): BlackRoomLedgerEntry {
  if (!input.jobId || !input.slot || !input.videoId) throw new Error("jobId, slot, and videoId are required");
  if (!input.dj.trim() || !input.caption.trim()) throw new Error("dj and caption are required");
  if (!input.renderPath.trim() || !input.sourcePath.trim()) throw new Error("renderPath and sourcePath are required");
  if (![15, 30, 60, 120, 300, 600].includes(input.durationSeconds)) throw new Error("unsupported duration");
  if (!Number.isFinite(input.segmentStartSeconds) || !Number.isFinite(input.segmentEndSeconds)
    || input.segmentStartSeconds < 0 || input.segmentEndSeconds <= input.segmentStartSeconds) throw new Error("invalid segment");
  if (ledger.entries.some((entry) => entry.status !== "discarded" && entry.jobId === input.jobId && entry.slot === input.slot)) throw new Error("slot already reserved");
  const overlaps = (entry: { videoId: string; segmentStartSeconds: number; segmentEndSeconds: number }) => entry.videoId === input.videoId
    && input.segmentStartSeconds < entry.segmentEndSeconds && entry.segmentStartSeconds < input.segmentEndSeconds;
  if (ledger.entries.some((entry) => entry.status !== "discarded" && overlaps(entry)) || Array.from(sourceHistory).some(overlaps)) {
    throw new Error("source video segment overlaps a previous BlackRoom clip");
  }
  const timestamp = now.toISOString();
  const entry: BlackRoomLedgerEntry = {
    ...input,
    creativeStrategy: input.creativeStrategy || "drop_first",
    reservationId: `${input.jobId}:${input.slot}:${input.videoId}`,
    status: "reserved",
    metricoolId: null,
    publicationDateTime: null,
    networkAttempts: {},
    networkReceipts: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  ledger.entries.push(entry);
  return entry;
}

/**
 * A pre-upload reservation whose local media is gone must not poison the
 * worker forever. Uncertain/confirmed entries are deliberately ineligible:
 * they can have a real remote side effect and must be verified instead.
 */
export function discardBlackRoomUnpublishedReservation(
  ledger: BlackRoomWorkerLedger,
  reservationId: string,
  now = new Date(),
): BlackRoomLedgerEntry {
  const entry = ledger.entries.find((candidate) => candidate.reservationId === reservationId);
  if (!entry) throw new Error("reservation not found");
  if (entry.status !== "reserved") throw new Error("only an unattempted reserved entry can be discarded");
  if (Object.keys(entry.networkAttempts || {}).length || Object.keys(entry.networkReceipts || {}).length || entry.metricoolId) {
    throw new Error("a reservation with Metricool evidence cannot be discarded");
  }
  entry.status = "discarded";
  entry.updatedAt = now.toISOString();
  return entry;
}

export function updateBlackRoomLedgerEntry(
  ledger: BlackRoomWorkerLedger,
  reservationId: string,
  update: { status: "confirmed"; metricoolId: string } | { status: "uncertain"; publicationDateTime?: string },
  now = new Date(),
): BlackRoomLedgerEntry {
  const entry = ledger.entries.find((candidate) => candidate.reservationId === reservationId);
  if (!entry) throw new Error("reservation not found");
  if (entry.status === "confirmed") throw new Error("confirmed reservation is immutable");
  if (update.status === "confirmed" && !hasCompleteBlackRoomMetricoolReceipt({ ...entry, metricoolId: update.metricoolId.trim() })) {
    throw new Error("complete Metricool receipts are required for confirmation");
  }
  if (update.status === "uncertain" && update.publicationDateTime
    && !isValidBlackRoomPublicationDateTime(update.publicationDateTime)) {
    throw new Error("invalid Metricool publication date");
  }
  entry.status = update.status;
  entry.metricoolId = update.status === "confirmed" ? update.metricoolId.trim() : null;
  if (update.status === "uncertain" && update.publicationDateTime) {
    entry.publicationDateTime = update.publicationDateTime;
  }
  entry.updatedAt = now.toISOString();
  return entry;
}

export function scheduleBlackRoomLedgerEntry(
  entry: BlackRoomLedgerEntry,
  publicationDateTime: string,
  now = new Date(),
): BlackRoomLedgerEntry {
  if (entry.status === "confirmed") throw new Error("confirmed reservation is immutable");
  if (!isValidBlackRoomPublicationDateTime(publicationDateTime)) {
    throw new Error("invalid Metricool publication date");
  }
  entry.publicationDateTime = publicationDateTime;
  entry.updatedAt = now.toISOString();
  return entry;
}

export function assertSafeConfirmedDeletion(projectDir: string, entry: BlackRoomLedgerEntry, filePath: string): string {
  if (entry.status !== "confirmed" || !hasCompleteBlackRoomMetricoolReceipt(entry)) {
    throw new Error("complete Metricool confirmations are required before deletion");
  }
  // The local runtime may be relocated from an iCloud-backed folder to a
  // stable disk folder. Resolve symlinks when the file exists so a confirmed
  // ledger entry recorded before that relocation still maps to the same
  // physical BlackRoom media file. The exact ledger membership check remains
  // mandatory, and nonexistent paths retain the deterministic path fallback.
  const resolvePhysicalPath = (value: string): string => {
    try { return realpathSync.native(value); }
    catch { return path.resolve(value); }
  };
  const resolvedProject = resolvePhysicalPath(projectDir);
  const resolvedFile = resolvePhysicalPath(filePath);
  const allowedRoots = [
    path.join(resolvedProject, "clippers_workspace/blackroom/sources"),
    path.join(resolvedProject, "clippers_workspace/blackroom/rendered"),
    // Legacy pilot renders used this directory before the worker standardized
    // on `rendered`; exact ledger membership is still required above.
    path.join(resolvedProject, "clippers_workspace/blackroom/renders"),
  ];
  if (![entry.renderPath, entry.sourcePath].map(resolvePhysicalPath).includes(resolvedFile)) throw new Error("file is not part of this reservation");
  if (!allowedRoots.some((root) => resolvedFile.startsWith(`${root}${path.sep}`))) throw new Error("file is outside BlackRoom media directories");
  return resolvedFile;
}
