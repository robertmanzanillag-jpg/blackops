import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBlackRoomDeliveryCounts,
  buildBlackRoomPublicationExperiments,
  planBlackRoomRemoteSync,
  summarizeBlackRoomDeliveryLedger,
} from "../script/blackroom-remote-sync.mjs";

test("confirmed local network receipts backfill normalized deduplicated experiments", () => {
  const ledger = { entries: [{
    status: "confirmed", reservationId: "r1", metricoolId: "tiktok:tt-1|facebook:fb-1|youtube:yt-1",
    networkReceipts: { tiktok: "tt-1", facebook: "fb-1", youtube: "yt-1" }, publicationDateTime: "2026-08-20T12:00:00",
    videoId: "source-1", sourceVideoTitle: "DJ A full set", dj: "DJ A", language: "en", format: "vertical", durationSeconds: 30,
    segmentStartSeconds: 120, segmentEndSeconds: 150, dropOffsetSeconds: 2, captionVariant: "en-1",
  }, {
    status: "confirmed", reservationId: "r2", metricoolId: "tiktok:tt-1", networkReceipts: { tiktok: "tt-1" },
    publicationDateTime: "2026-08-21T12:00:00", videoId: "source-2", dj: "DJ B", language: "es", format: "vertical", durationSeconds: 15,
    creativeStrategy: "context_open_loop",
  }, { status: "reserved", reservationId: "ignored", networkReceipts: { tiktok: "nope" } }] };
  const experiments = buildBlackRoomPublicationExperiments(ledger);
  assert.equal(experiments.length, 3);
  const tiktok = experiments.find((item) => item.network === "tiktok");
  assert.equal(tiktok.reservationId, "r2");
  assert.equal(tiktok.creativeStrategy, "context_open_loop");
  assert.equal(experiments.find((item) => item.network === "facebook").sourceVideoTitle, "DJ A full set");
  assert.equal(experiments.find((item) => item.network === "youtube").creativeStrategy, "drop_first");
});

test("newer pause cannot be undone by an older play response", () => {
  const play = planBlackRoomRemoteSync({
    control: { generation: 1, desiredEnabled: true }, localEnabled: false, lastAppliedGeneration: -1,
  });
  assert.deepEqual(play, { action: "start", generation: 1 });

  const pause = planBlackRoomRemoteSync({
    control: { generation: 2, desiredEnabled: false }, localEnabled: true, lastAppliedGeneration: play.generation,
  });
  assert.deepEqual(pause, { action: "pause", generation: 2 });

  const stalePlay = planBlackRoomRemoteSync({
    control: { generation: 1, desiredEnabled: true }, localEnabled: false, lastAppliedGeneration: pause.generation,
  });
  assert.deepEqual(stalePlay, { action: "ignore", generation: 2 });
});

test("already-applied desired state advances generation without restarting", () => {
  assert.deepEqual(planBlackRoomRemoteSync({
    control: { generation: 4, desiredEnabled: true }, localEnabled: true, lastAppliedGeneration: 3,
  }), { action: "none", generation: 4 });
});

test("pause remains pending until the local worker has stopped", () => {
  assert.deepEqual(planBlackRoomRemoteSync({
    control: { generation: 2, desiredEnabled: false },
    localEnabled: false,
    localWorkerRunning: true,
    lastAppliedGeneration: 1,
  }), { action: "pause", generation: 2 });
  assert.deepEqual(planBlackRoomRemoteSync({
    control: { generation: 2, desiredEnabled: false },
    localEnabled: false,
    localWorkerRunning: false,
    lastAppliedGeneration: 1,
  }), { action: "none", generation: 2 });
});

test("delivery ledger drives scheduled and completed post counters", () => {
  const ledger = {
    entries: [
      {
        status: "confirmed",
        publicationDateTime: "2026-07-22T06:30:00",
        networkReceipts: { tiktok: "1", facebook: "2", youtube: "3" },
      },
      {
        status: "confirmed",
        publicationDateTime: "2026-07-22T02:00:00",
        networkReceipts: { tiktok: "4", facebook: "5", youtube: "6" },
      },
      {
        status: "confirmed",
        publicationDateTime: "2026-07-22T10:00:00",
        networkReceipts: { tiktok: "7", facebook: "8" },
      },
      {
        status: "confirmed",
        publicationDateTime: "9999-99-99T99:99:99",
        networkReceipts: { tiktok: "9", facebook: "10", youtube: "11" },
      },
      { status: "reserved", publicationDateTime: "2026-07-22T12:00:00", networkReceipts: {} },
    ],
  };
  const delivery = summarizeBlackRoomDeliveryLedger(ledger, new Date("2026-07-22T07:34:00.000Z"));
  assert.deepEqual(delivery, { scheduled: 1, completed: 1, confirmed: 2 });

  const queue = applyBlackRoomDeliveryCounts(
    { totals: { queued: 15, processing: 0, retry: 1, scheduled: 0, completed: 0 } },
    delivery,
  );
  assert.deepEqual(queue.totals, { queued: 15, processing: 0, retry: 1, scheduled: 1, completed: 1 });
  assert.deepEqual(queue.delivery, delivery);
});
