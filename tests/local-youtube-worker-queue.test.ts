import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalYoutubeWorkerInput,
  formatLocalYoutubeWorkerQueuedMessage,
  isLocalYoutubeWorkerAction,
  LOCAL_YOUTUBE_WORKER_FLAG,
  shouldQueueYoutubeForLocalWorker,
} from "../server/local-youtube-worker-queue";
import type { DirectRadioYoutubeCommand } from "../server/radio-youtube-command";

const command: DirectRadioYoutubeCommand = {
  youtubeUrl: "https://youtu.be/GcVZvXkz2jU",
  driveFolderPath: [],
  driveParentFolderId: "1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW",
  createFolderIfMissing: false,
  djName: "DJ TEST",
  instagramClipCount: 3,
  tiktokClipCount: 3,
  deleteSourceAfterSuccess: true,
  content: "Dale.",
  command: "[RADIO_YOUTUBE_CLIPS: {}]",
};

test("builds a local-worker-only YouTube action input", () => {
  const input = buildLocalYoutubeWorkerInput(command);

  assert.equal(input.youtubeUrl, "https://youtu.be/GcVZvXkz2jU");
  assert.equal(input.driveParentFolderId, "1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW");
  assert.equal(input.localWorkerOnly, true);
  assert.equal(input.localWorker, LOCAL_YOUTUBE_WORKER_FLAG);
  assert.equal(input.instagramClipCount, 3);
  assert.equal(input.tiktokClipCount, 3);
  assert.equal(input.deleteSourceAfterSuccess, true);
});

test("identifies only pending local YouTube worker actions", () => {
  const baseAction = {
    actionType: "radio_edit.youtube_to_drive",
    status: "pending",
    input: buildLocalYoutubeWorkerInput(command),
    editedInput: null,
  } as any;

  assert.equal(isLocalYoutubeWorkerAction(baseAction), true);
  assert.equal(isLocalYoutubeWorkerAction({ ...baseAction, status: "approved" }), false);
  assert.equal(isLocalYoutubeWorkerAction({ ...baseAction, actionType: "radio_edit.drive_video_to_drive" }), false);
  assert.equal(isLocalYoutubeWorkerAction({ ...baseAction, input: { youtubeUrl: command.youtubeUrl } }), false);
});

test("local worker queue mode is enabled unless explicitly disabled", () => {
  const previous = process.env.RADIO_YOUTUBE_LOCAL_WORKER_MODE;
  try {
    delete process.env.RADIO_YOUTUBE_LOCAL_WORKER_MODE;
    assert.equal(shouldQueueYoutubeForLocalWorker(), true);
    process.env.RADIO_YOUTUBE_LOCAL_WORKER_MODE = "replit";
    assert.equal(shouldQueueYoutubeForLocalWorker(), false);
    process.env.RADIO_YOUTUBE_LOCAL_WORKER_MODE = "enabled";
    assert.equal(shouldQueueYoutubeForLocalWorker(), true);
  } finally {
    if (previous === undefined) delete process.env.RADIO_YOUTUBE_LOCAL_WORKER_MODE;
    else process.env.RADIO_YOUTUBE_LOCAL_WORKER_MODE = previous;
  }
});

test("queued message explains offline Mac behavior and zero cost", () => {
  const message = formatLocalYoutubeWorkerQueuedMessage("queue-123");

  assert.match(message, /cola para tu Mac/);
  assert.match(message, /Mac está apagada/);
  assert.match(message, /subirlos a Drive/);
  assert.match(message, /borrar el video largo local/);
  assert.match(message, /queue-123/);
  assert.match(message, /\$0\.00 USD/);
});
