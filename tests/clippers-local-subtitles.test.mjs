import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseSrt, renderAssignedBatch, renderLocalSubtitles } from "../script/clippers-local-subtitles.mjs";

test("parses valid SRT segments and ignores malformed blocks", () => {
  const rows = parseSrt(`1\n00:00:01,250 --> 00:00:03,500\nThis is the hook.\n\n2\ninvalid\nIgnored\n\n3\n00:00:04,000 --> 00:00:05,250\nSecond line\ncontinues.`);
  assert.deepEqual(rows, [
    { start: 1.25, end: 3.5, caption: "This is the hook." },
    { start: 4, end: 5.25, caption: "Second line continues." },
  ]);
});

test("rejects unsupported modes before starting external tools", async () => {
  await assert.rejects(
    renderLocalSubtitles({ input: "a.mp4", output: "b.mp4", model: "model.bin", mode: "karaoke" }),
    /Unsupported subtitle mode/,
  );
});

test("refuses to overwrite the source draft", async () => {
  await assert.rejects(
    renderLocalSubtitles({ input: "a.mp4", output: "a.mp4", model: "model.bin" }),
    /must not overwrite/,
  );
});

test("batch rejects draft paths outside the Clippers workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-batch-test-"));
  try {
    await mkdir(path.join(root, "reports"));
    await writeFile(path.join(root, "reports", "streamer-growth-ceo.json"), JSON.stringify({
      decisions: [{ campaignId: "unsafe", canProduce: true, assignments: [{ slot: 1, draftFile: "../outside.mp4", subtitleStyle: "clean_sentence" }] }],
    }));
    await assert.rejects(
      renderAssignedBatch({ workspaceRoot: root, model: path.join(root, "model.bin") }),
      /escapes Clippers workspace/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("batch skips subtitle work for blocked campaigns", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-blocked-batch-test-"));
  try {
    await mkdir(path.join(root, "reports"));
    await writeFile(path.join(root, "reports", "streamer-growth-ceo.json"), JSON.stringify({
      decisions: [{ campaignId: "blocked", canProduce: false, assignments: [{ slot: 1, draftFile: "missing.mp4", subtitleStyle: "clean_sentence" }] }],
    }));
    const result = await renderAssignedBatch({ workspaceRoot: root, model: path.join(root, "model.bin") });
    assert.equal(result.blocked, 1);
    assert.equal(result.rendered, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("batch rejects files reached through a symlinked parent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-symlink-batch-test-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "clippers-outside-drafts-"));
  try {
    await mkdir(path.join(root, "reports"));
    await writeFile(path.join(outside, "draft.mp4"), "not authorized media");
    await symlink(outside, path.join(root, "linked-drafts"));
    await writeFile(path.join(root, "reports", "streamer-growth-ceo.json"), JSON.stringify({
      decisions: [{ campaignId: "unsafe", canProduce: true, assignments: [{ slot: 1, draftFile: "linked-drafts/draft.mp4", subtitleStyle: "clean_sentence" }] }],
    }));
    await assert.rejects(
      renderAssignedBatch({ workspaceRoot: root, model: path.join(root, "model.bin") }),
      /missing, not a regular file, or symlinked/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
