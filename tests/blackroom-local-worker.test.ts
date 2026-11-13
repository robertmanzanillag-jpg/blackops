import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES,
  BLACKROOM_FFPROBE_SHOW_ENTRIES,
  buildBlackRoomUploadChunks,
  blackRoomEditorExitMessage,
  assertSafeConfirmedDeletion,
  buildBlackRoomLocalEditorArgs,
  confirmBlackRoomNetworkReceipt,
  createBlackRoomLocalWorkerState,
  createBlackRoomWorkerLedger,
  discardBlackRoomUnpublishedReservation,
  hasCompleteBlackRoomMetricoolReceipt,
  nextBlackRoomPublicationDateTime,
  resolveBlackRoomPublicationDateTime,
  isBlackRoomJobPublishable,
  isBlackRoomSourceSegmentRecorded,
  markBlackRoomNetworkUncertain,
  reserveBlackRoomLedgerEntry,
  resetBlackRoomNetworkAttempt,
  requiredBlackRoomReceiptNetworks,
  scheduleBlackRoomLedgerEntry,
  selectPublishableBlackRoomReservation,
  shouldRunBlackRoomWorker,
  updateBlackRoomLedgerEntry,
  validateBlackRoomRenderProbe,
  validateBlackRoomAudioLoudness,
} from "../server/blackroom-local-worker";

const mediaDetails = {
  dj: "DJ Test", language: "en" as const, format: "vertical" as const, durationSeconds: 30 as const,
  segmentStartSeconds: 10, segmentEndSeconds: 40, caption: "Drop incoming.",
};

test("splits remote video uploads below Replit's per-request limit", () => {
  const totalBytes = BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES * 2 + 123;
  assert.deepEqual(buildBlackRoomUploadChunks(totalBytes), [
    { index: 0, start: 0, end: BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES - 1, size: BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES },
    { index: 1, start: BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES, end: BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES * 2 - 1, size: BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES },
    { index: 2, start: BLACKROOM_REMOTE_UPLOAD_CHUNK_BYTES * 2, end: totalBytes - 1, size: 123 },
  ]);
  assert.throws(() => buildBlackRoomUploadChunks(0), /Invalid BlackRoom upload size/);
});

test("worker only runs for an enabled actionable queue", () => {
  assert.equal(shouldRunBlackRoomWorker({ enabled: false, jobs: [{ status: "queued" }] }), false);
  assert.equal(shouldRunBlackRoomWorker({ enabled: true, jobs: [{ status: "completed" }] }), false);
  assert.equal(shouldRunBlackRoomWorker({ enabled: true, jobs: [{ status: "retry" }] }), true);
  assert.equal(shouldRunBlackRoomWorker({ enabled: true, jobs: [{ status: "retry", notBefore: "2026-07-21T00:00:00.000Z" }] }, new Date("2026-07-20T23:00:00.000Z")), false);
});

test("publishing gate honors pause and skips stale reservations", () => {
  const queue = {
    enabled: true,
    jobs: [
      { id: "completed-job", status: "completed" },
      { id: "active-job", status: "retry", notBefore: "2026-07-21T00:00:00.000Z" },
    ],
  };
  const entries = [
    { status: "reserved", jobId: "missing-job", reservationId: "stale-1" },
    { status: "reserved", jobId: "completed-job", reservationId: "stale-2" },
    { status: "reserved", jobId: "active-job", reservationId: "ready" },
  ];
  const now = new Date("2026-07-21T01:00:00.000Z");
  assert.equal(selectPublishableBlackRoomReservation(queue, entries, now)?.reservationId, "ready");
  assert.equal(selectPublishableBlackRoomReservation(queue, [{ status: "uncertain", jobId: "active-job", reservationId: "verify-only" }], now)?.reservationId, "verify-only");
  assert.equal(isBlackRoomJobPublishable({ ...queue, enabled: false }, "active-job", now), false);
  assert.equal(selectPublishableBlackRoomReservation({ ...queue, enabled: false }, entries, now), null);
});

test("owner-scheduled reservations run first in chronological order", () => {
  const queue = { enabled: true, jobs: [{ id: "active-job", status: "retry" }] };
  const entries = [
    { status: "reserved", jobId: "active-job", reservationId: "legacy", publicationDateTime: null },
    { status: "reserved", jobId: "active-job", reservationId: "later", publicationDateTime: "2026-07-21T22:45:00" },
    { status: "reserved", jobId: "active-job", reservationId: "earlier", publicationDateTime: "2026-07-21T20:45:00" },
  ];
  assert.equal(selectPublishableBlackRoomReservation(queue, entries)?.reservationId, "earlier");
});

test("worker state starts stopped and recoverable", () => {
  assert.deepEqual(createBlackRoomLocalWorkerState(), {
    running: false, workerPid: null, pid: null, startedAt: null, finishedAt: null, lastExitCode: null, lastError: null, runs: 0,
  });
});

test("worker launches the local deterministic editor without Codex", () => {
  const args = buildBlackRoomLocalEditorArgs("/tmp/blackroom-project");
  assert.deepEqual(args, [
    "--experimental-strip-types",
    "--import",
    "/tmp/blackroom-project/script/register-native-typescript.mjs",
    "/tmp/blackroom-project/script/blackroom-deterministic-editor.ts",
  ]);
  assert.equal(args.join(" ").toLowerCase().includes("codex"), false);
  assert.equal(args.join(" ").toLowerCase().includes("tsx"), false);
});

test("worker records distinct non-overlapping moments from the same source independently", () => {
  const history = [{ videoId: "same-set", segmentStartSeconds: 10, segmentEndSeconds: 40 }];
  assert.equal(isBlackRoomSourceSegmentRecorded(history, { videoId: "same-set", segmentStartSeconds: 10, segmentEndSeconds: 40 }), true);
  assert.equal(isBlackRoomSourceSegmentRecorded(history, { videoId: "same-set", segmentStartSeconds: 50, segmentEndSeconds: 80 }), false);
  assert.equal(isBlackRoomSourceSegmentRecorded(history, { videoId: "other-set", segmentStartSeconds: 10, segmentEndSeconds: 40 }), false);
});

test("editor completion activity distinguishes a real finish from a pause", () => {
  assert.deepEqual(blackRoomEditorExitMessage(true), {
    message: "Descarga y edición terminadas; buscando el clip reservado para publicarlo.",
    level: "success",
  });
  assert.deepEqual(blackRoomEditorExitMessage(false), {
    message: "Edición detenida por pausa; no se iniciarán nuevos clips.",
    level: "info",
  });
});

test("requires YouTube only for clips eligible as Shorts", () => {
  assert.deepEqual(requiredBlackRoomReceiptNetworks({ format: "vertical", durationSeconds: 30 }), ["tiktok", "facebook", "youtube"]);
  assert.deepEqual(requiredBlackRoomReceiptNetworks({ format: "vertical", durationSeconds: 120 }), ["tiktok", "facebook", "youtube"]);
  assert.deepEqual(requiredBlackRoomReceiptNetworks({ format: "horizontal", durationSeconds: 30 }), ["tiktok", "facebook"]);
  assert.deepEqual(requiredBlackRoomReceiptNetworks({ format: "horizontal", durationSeconds: 600 }), ["tiktok", "facebook"]);
  assert.equal(hasCompleteBlackRoomMetricoolReceipt({
    format: "vertical", durationSeconds: 30, metricoolId: "tiktok:1|facebook:2",
  }), false);
  assert.equal(hasCompleteBlackRoomMetricoolReceipt({
    format: "vertical", durationSeconds: 30, metricoolId: "tiktok:1|facebook:2|youtube:3",
  }), true);
  assert.equal(hasCompleteBlackRoomMetricoolReceipt({
    format: "horizontal", durationSeconds: 600, metricoolId: "tiktok:1|facebook:2",
  }), true);
});


test("explicit network orders require only their selected compatible receipts", () => {
  const targeted = { format: "vertical" as const, durationSeconds: 30 as const, targetNetworks: ["facebook", "youtube"] as Array<"facebook" | "youtube"> };
  assert.deepEqual(requiredBlackRoomReceiptNetworks(targeted), ["facebook", "youtube"]);
  assert.equal(hasCompleteBlackRoomMetricoolReceipt({ ...targeted, metricoolId: "facebook:2|youtube:3" }), true);
  assert.equal(hasCompleteBlackRoomMetricoolReceipt({ ...targeted, metricoolId: "facebook:2" }), false);
  assert.throws(() => requiredBlackRoomReceiptNetworks({
    format: "horizontal", durationSeconds: 30, targetNetworks: ["youtube"],
  }), /incompatible/);
});

test("past BlackRoom slots roll forward while future slots keep their target date", () => {
  const now = new Date("2026-07-21T07:00:00.000Z"); // 03:00 in New York.
  assert.equal(nextBlackRoomPublicationDateTime("2026-07-21", "05:00", "America/New_York", now), "2026-07-21T05:00:00");
  assert.equal(nextBlackRoomPublicationDateTime("2026-07-21", "00:30", "America/New_York", now), "2026-07-22T00:30:00");
});

test("stale unattempted reservations roll forward but uncertain network attempts keep their exact date", () => {
  const now = new Date("2026-07-22T07:30:00.000Z"); // 03:30 America/New_York
  const job = { targetDate: "2026-07-21" };
  assert.equal(resolveBlackRoomPublicationDateTime({
    status: "reserved", slot: "14:00", publicationDateTime: "2026-07-21T23:45:00", networkAttempts: {}, networkReceipts: {},
  }, job, "America/New_York", now), "2026-07-22T14:00:00");
  assert.equal(resolveBlackRoomPublicationDateTime({
    status: "uncertain", slot: "14:00", publicationDateTime: "2026-07-21T23:45:00", networkAttempts: { tiktok: "uncertain" }, networkReceipts: {},
  }, job, "America/New_York", now), "2026-07-21T23:45:00");
  assert.equal(resolveBlackRoomPublicationDateTime({
    status: "reserved", slot: "14:00", publicationDateTime: "2026-07-22T16:00:00", networkAttempts: {}, networkReceipts: {},
  }, job, "America/New_York", now), "2026-07-22T16:00:00");
});

test("validates Metricool and TikTok compatible MP4 renders", () => {
  assert.match(BLACKROOM_FFPROBE_SHOW_ENTRIES, /stream=.*duration.*channels/);
  const valid = {
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "30.02" },
    streams: [
      { codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", width: 1080, height: 1920 },
      { codec_type: "audio", codec_name: "aac", channels: 2, duration: "30.02" },
    ],
  };
  assert.deepEqual(validateBlackRoomRenderProbe(valid, 30), { durationSeconds: 30.02, width: 1080, height: 1920 });
  assert.throws(() => validateBlackRoomRenderProbe({ ...valid, streams: [{ ...valid.streams[0], codec_name: "hevc" }, valid.streams[1]] }, 30), /H\.264/);
  assert.throws(() => validateBlackRoomRenderProbe({ ...valid, format: { ...valid.format, duration: "25" } }, 30), /duration/);
  assert.throws(() => validateBlackRoomRenderProbe({ ...valid, streams: [valid.streams[0], { ...valid.streams[1], duration: "2" }] }, 30), /audio track/);
  assert.throws(() => validateBlackRoomRenderProbe({ ...valid, streams: [valid.streams[0], { ...valid.streams[1], channels: 0 }] }, 30), /audio track/);
});

test("rejects silent or nearly silent DJ audio before upload", () => {
  assert.deepEqual(validateBlackRoomAudioLoudness("mean_volume: -12.4 dB\nmax_volume: -0.8 dB"), { meanVolumeDb: -12.4, maxVolumeDb: -0.8 });
  assert.throws(() => validateBlackRoomAudioLoudness("mean_volume: -inf dB\nmax_volume: -inf dB"), /silent/);
  assert.throws(() => validateBlackRoomAudioLoudness("mean_volume: -50.0 dB\nmax_volume: -35.0 dB"), /audible-volume/);
  assert.throws(() => validateBlackRoomAudioLoudness("no volumedetect summary"), /silent/);
});

test("ledger blocks duplicate slots and overlapping source segments", () => {
  const ledger = createBlackRoomWorkerLedger();
  reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-1", slot: "00:30", videoId: "video-1",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/a.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/a.mp4",
  });
  assert.throws(() => reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-1", slot: "00:30", videoId: "video-2",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/b.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/b.mp4",
  }), /slot already reserved/);
  assert.throws(() => reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-1", slot: "02:00", videoId: "video-1",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/c.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/c.mp4",
  }), /segment overlaps/);
  assert.doesNotThrow(() => reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    segmentStartSeconds: 100, segmentEndSeconds: 130,
    jobId: "job-1", slot: "03:30", videoId: "video-1",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/d.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/d.mp4",
  }));
});

test("an unattempted reservation with missing local media can be discarded and replaced", () => {
  const ledger = createBlackRoomWorkerLedger();
  const original = reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-stale", slot: "00:30", videoId: "old-video",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/missing.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/missing.mp4",
  });
  assert.equal(discardBlackRoomUnpublishedReservation(ledger, original.reservationId).status, "discarded");
  assert.doesNotThrow(() => reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-stale", slot: "00:30", videoId: "old-video",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/replacement.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/replacement.mp4",
  }));
  assert.throws(() => discardBlackRoomUnpublishedReservation(ledger, original.reservationId), /only an unattempted/);
});

test("uncertain reservations persist their exact Metricool schedule for verification-only recovery", () => {
  const ledger = createBlackRoomWorkerLedger();
  const entry = reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-1", slot: "00:30", videoId: "video-1",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/a.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/a.mp4",
  });
  updateBlackRoomLedgerEntry(ledger, entry.reservationId, { status: "uncertain", publicationDateTime: "2026-07-22T00:30:00" });
  assert.equal(entry.status, "uncertain");
  assert.equal(entry.publicationDateTime, "2026-07-22T00:30:00");
  assert.throws(() => updateBlackRoomLedgerEntry(ledger, entry.reservationId, { status: "uncertain", publicationDateTime: "tomorrow" }), /invalid Metricool publication date/);
});

test("persists Metricool progress independently for each network", () => {
  const ledger = createBlackRoomWorkerLedger();
  const entry = reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-1", slot: "00:30", videoId: "video-1",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/a.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/a.mp4",
  });
  markBlackRoomNetworkUncertain(entry, "tiktok", "2026-07-22T00:30:00");
  assert.deepEqual(entry.networkAttempts, { tiktok: "uncertain" });
  assert.equal((entry.networkAttempts as Record<string, string>).facebook, undefined);

  confirmBlackRoomNetworkReceipt(entry, "tiktok", "991");
  assert.deepEqual(entry.networkReceipts, { tiktok: "991" });
  assert.equal(entry.networkAttempts.tiktok, "confirmed");

  markBlackRoomNetworkUncertain(entry, "facebook", "2026-07-22T00:30:00");
  resetBlackRoomNetworkAttempt(entry, "facebook");
  assert.equal((entry.networkAttempts as Record<string, string>).facebook, undefined);
  assert.equal((entry.networkReceipts as Record<string, string>).facebook, undefined);
  assert.equal(entry.networkReceipts.tiktok, "991");
});

test("schedules an unconfirmed reservation without making it uncertain", () => {
  const ledger = createBlackRoomWorkerLedger();
  const entry = reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-1", slot: "00:30", videoId: "video-1",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/a.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/a.mp4",
  });
  scheduleBlackRoomLedgerEntry(entry, "2026-07-21T20:45:00");
  assert.equal(entry.status, "reserved");
  assert.equal(entry.publicationDateTime, "2026-07-21T20:45:00");
  assert.throws(() => scheduleBlackRoomLedgerEntry(entry, "tonight"), /invalid Metricool publication date/);
  assert.throws(() => scheduleBlackRoomLedgerEntry(entry, "2026-13-40T25:99:99"), /invalid Metricool publication date/);
  assert.throws(() => scheduleBlackRoomLedgerEntry(entry, "2026-02-30T20:45:00"), /invalid Metricool publication date/);
});

test("safe deletion requires confirmed Metricool receipt and exact media path", () => {
  const project = "/tmp/project";
  const ledger = createBlackRoomWorkerLedger();
  const entry = reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-1", slot: "00:30", videoId: "video-1",
    renderPath: `${project}/clippers_workspace/blackroom/rendered/a.mp4`,
    sourcePath: `${project}/clippers_workspace/blackroom/sources/a.mp4`,
  });
  assert.throws(() => assertSafeConfirmedDeletion(project, entry, entry.renderPath), /confirmations are required/);
  assert.throws(() => updateBlackRoomLedgerEntry(ledger, entry.reservationId, { status: "confirmed", metricoolId: "metricool-123" }), /complete Metricool receipts/);
  updateBlackRoomLedgerEntry(ledger, entry.reservationId, { status: "confirmed", metricoolId: "tiktok:991|facebook:992|youtube:993" });
  assert.equal(assertSafeConfirmedDeletion(project, entry, entry.renderPath), entry.renderPath);
  assert.throws(() => assertSafeConfirmedDeletion(project, entry, `${project}/package.json`), /not part of this reservation/);

  const legacy = { ...entry, renderPath: `${project}/clippers_workspace/blackroom/renders/legacy.mp4` };
  assert.equal(assertSafeConfirmedDeletion(project, legacy, legacy.renderPath), legacy.renderPath);

  const historicalSingleNetwork = { ...entry, metricoolId: "991", renderPath: `${project}/clippers_workspace/blackroom/renders/old.mp4` };
  assert.throws(() => assertSafeConfirmedDeletion(project, historicalSingleNetwork, historicalSingleNetwork.renderPath), /complete Metricool confirmations/);
});

test("safe deletion accepts an exact confirmed media file through a relocated runtime symlink", () => {
  const root = mkdtempSync(path.join(tmpdir(), "blackroom-runtime-"));
  const stableProject = path.join(root, "stable");
  const previousProject = path.join(root, "previous");
  const rendered = path.join(stableProject, "clippers_workspace/blackroom/rendered");
  mkdirSync(rendered, { recursive: true });
  const stableFile = path.join(rendered, "confirmed.mp4");
  writeFileSync(stableFile, "video");
  symlinkSync(stableProject, previousProject);
  const legacyFile = path.join(previousProject, "clippers_workspace/blackroom/rendered/confirmed.mp4");
  const ledger = createBlackRoomWorkerLedger();
  const entry = reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-relocated", slot: "01:00", videoId: "video-relocated",
    renderPath: legacyFile,
    sourcePath: path.join(previousProject, "clippers_workspace/blackroom/sources/confirmed.mp4"),
  });
  updateBlackRoomLedgerEntry(ledger, entry.reservationId, { status: "confirmed", metricoolId: "tiktok:991|facebook:992|youtube:993" });
  assert.equal(assertSafeConfirmedDeletion(stableProject, entry, legacyFile), realpathSync(stableFile));
});

test("ledger rejects overlap with queue history but permits a different moment", () => {
  const ledger = createBlackRoomWorkerLedger();
  const history = [{ videoId: "video-used", segmentStartSeconds: 5, segmentEndSeconds: 35 }];
  assert.throws(() => reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-1", slot: "00:30", videoId: "video-used",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/a.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/a.mp4",
  }, history), /segment overlaps/);
  assert.doesNotThrow(() => reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    segmentStartSeconds: 50, segmentEndSeconds: 80,
    jobId: "job-1", slot: "02:00", videoId: "video-used",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/b.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/b.mp4",
  }, history));
});

test("ledger rejects missing paths and non-finite segment boundaries", () => {
  const ledger = createBlackRoomWorkerLedger();
  assert.throws(() => reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails,
    jobId: "job-1", slot: "00:30", videoId: "video-1", renderPath: "", sourcePath: "",
  }), /Path.*required/);
  assert.throws(() => reserveBlackRoomLedgerEntry(ledger, {
    ...mediaDetails, segmentEndSeconds: Number.NaN,
    jobId: "job-1", slot: "00:30", videoId: "video-1",
    renderPath: "/tmp/project/clippers_workspace/blackroom/rendered/a.mp4",
    sourcePath: "/tmp/project/clippers_workspace/blackroom/sources/a.mp4",
  }), /invalid segment/);
});
