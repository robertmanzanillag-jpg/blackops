import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  enqueueLocalYoutubeAction,
  getLocalYoutubeQueue,
  getLocalYoutubeQueueEntry,
  getPendingLocalYoutubeQueue,
  updateLocalYoutubeQueueEntry,
  formatQueuedMessage,
  type LocalYoutubeQueueEntry,
} from "../server/local-youtube-queue";
import type { DirectRadioYoutubeCommand } from "../server/radio-youtube-command";

function tmpQueuePath(): string {
  return path.join(tmpdir(), `test-yt-queue-${Math.random().toString(36).slice(2)}.json`);
}

const SAMPLE_COMMAND: DirectRadioYoutubeCommand = {
  youtubeUrl: "https://youtu.be/test123",
  driveFolderPath: ["Radio Junio", "Videos"],
  djName: "DJ Test",
  instagramClipCount: 1,
  tiktokClipCount: 1,
  deleteSourceAfterSuccess: true,
  content: "Dale.",
  command: '[RADIO_YOUTUBE_CLIPS: {"youtubeUrl":"https://youtu.be/test123"}]',
};

test("enqueueLocalYoutubeAction creates a pending entry", () => {
  const queuePath = tmpQueuePath();
  try {
    const entry = enqueueLocalYoutubeAction(SAMPLE_COMMAND, "user-1", queuePath);
    assert.equal(entry.status, "pending");
    assert.equal(entry.userId, "user-1");
    assert.equal(entry.command.youtubeUrl, "https://youtu.be/test123");
    assert.ok(entry.id, "entry.id should be set");
    assert.ok(entry.createdAt, "entry.createdAt should be set");
  } finally {
    if (existsSync(queuePath)) rmSync(queuePath);
  }
});

test("getLocalYoutubeQueue returns all entries", () => {
  const queuePath = tmpQueuePath();
  try {
    assert.deepEqual(getLocalYoutubeQueue(queuePath), []);

    enqueueLocalYoutubeAction(SAMPLE_COMMAND, "user-1", queuePath);
    enqueueLocalYoutubeAction({ ...SAMPLE_COMMAND, youtubeUrl: "https://youtu.be/second" }, "user-2", queuePath);

    const all = getLocalYoutubeQueue(queuePath);
    assert.equal(all.length, 2);
    assert.equal(all[0].command.youtubeUrl, "https://youtu.be/test123");
    assert.equal(all[1].command.youtubeUrl, "https://youtu.be/second");
  } finally {
    if (existsSync(queuePath)) rmSync(queuePath);
  }
});

test("getLocalYoutubeQueueEntry finds by id", () => {
  const queuePath = tmpQueuePath();
  try {
    const e1 = enqueueLocalYoutubeAction(SAMPLE_COMMAND, "user-1", queuePath);
    enqueueLocalYoutubeAction({ ...SAMPLE_COMMAND, youtubeUrl: "https://youtu.be/other" }, "user-2", queuePath);

    const found = getLocalYoutubeQueueEntry(e1.id, queuePath);
    assert.ok(found);
    assert.equal(found!.id, e1.id);
    assert.equal(found!.command.youtubeUrl, "https://youtu.be/test123");

    const notFound = getLocalYoutubeQueueEntry("nonexistent-id", queuePath);
    assert.equal(notFound, undefined);
  } finally {
    if (existsSync(queuePath)) rmSync(queuePath);
  }
});

test("getPendingLocalYoutubeQueue filters only pending", () => {
  const queuePath = tmpQueuePath();
  try {
    const e1 = enqueueLocalYoutubeAction(SAMPLE_COMMAND, "user-1", queuePath);
    const e2 = enqueueLocalYoutubeAction({ ...SAMPLE_COMMAND, youtubeUrl: "https://youtu.be/done" }, "user-1", queuePath);

    updateLocalYoutubeQueueEntry(e2.id, { status: "done", processedAt: new Date().toISOString() }, queuePath);

    const pending = getPendingLocalYoutubeQueue(queuePath);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, e1.id);
  } finally {
    if (existsSync(queuePath)) rmSync(queuePath);
  }
});

test("updateLocalYoutubeQueueEntry updates status and metadata", () => {
  const queuePath = tmpQueuePath();
  try {
    const entry = enqueueLocalYoutubeAction(SAMPLE_COMMAND, "user-1", queuePath);

    updateLocalYoutubeQueueEntry(entry.id, { status: "processing" }, queuePath);
    const processing = getLocalYoutubeQueueEntry(entry.id, queuePath)!;
    assert.equal(processing.status, "processing");

    const processedAt = new Date().toISOString();
    updateLocalYoutubeQueueEntry(entry.id, { status: "done", processedAt, result: { clips: [] } }, queuePath);
    const done = getLocalYoutubeQueueEntry(entry.id, queuePath)!;
    assert.equal(done.status, "done");
    assert.equal(done.processedAt, processedAt);
    assert.deepEqual((done.result as any).clips, []);
  } finally {
    if (existsSync(queuePath)) rmSync(queuePath);
  }
});

test("updateLocalYoutubeQueueEntry returns undefined for unknown id", () => {
  const queuePath = tmpQueuePath();
  try {
    const result = updateLocalYoutubeQueueEntry("no-such-id", { status: "failed" }, queuePath);
    assert.equal(result, undefined);
  } finally {
    if (existsSync(queuePath)) rmSync(queuePath);
  }
});

test("multiple enqueue calls persist all entries independently", () => {
  const queuePath = tmpQueuePath();
  try {
    const COUNT = 5;
    const entries: LocalYoutubeQueueEntry[] = [];
    for (let i = 0; i < COUNT; i++) {
      entries.push(enqueueLocalYoutubeAction({ ...SAMPLE_COMMAND, youtubeUrl: `https://youtu.be/vid${i}` }, "user-1", queuePath));
    }

    const all = getLocalYoutubeQueue(queuePath);
    assert.equal(all.length, COUNT);
    for (let i = 0; i < COUNT; i++) {
      assert.equal(all[i].id, entries[i].id);
      assert.equal(all[i].command.youtubeUrl, `https://youtu.be/vid${i}`);
    }
  } finally {
    if (existsSync(queuePath)) rmSync(queuePath);
  }
});

test("formatQueuedMessage includes key fields", () => {
  const queuePath = tmpQueuePath();
  try {
    const entry = enqueueLocalYoutubeAction(SAMPLE_COMMAND, "user-1", queuePath);
    const msg = formatQueuedMessage(entry);
    assert.ok(msg.includes(entry.id), "should include job id");
    assert.ok(msg.includes("https://youtu.be/test123"), "should include YouTube URL");
    assert.ok(msg.includes("DJ Test"), "should include DJ name");
    assert.ok(msg.includes("radio:local-worker"), "should mention worker command");
    assert.ok(msg.includes("$0.00"), "should mention $0.00 cost");
  } finally {
    if (existsSync(queuePath)) rmSync(queuePath);
  }
});

test("getLocalYoutubeQueue is safe on missing or empty file", () => {
  const queuePath = tmpQueuePath();
  assert.deepEqual(getLocalYoutubeQueue(queuePath), []);
  assert.equal(existsSync(queuePath), false);
});
