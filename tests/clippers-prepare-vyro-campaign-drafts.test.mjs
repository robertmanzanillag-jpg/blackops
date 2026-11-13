import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("checks campaign evidence before creating derivative media", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-vyro-evidence-gate-"));
  const outputDir = path.join(root, "drafts", "vyro", "mrbeast-jre-2026-07-21");
  try {
    await assert.rejects(
      execFileAsync(process.execPath, ["script/clippers-prepare-vyro-campaign-drafts.mjs"], {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: { ...process.env, CLIPPERS_WORKSPACE_ROOT: root },
      }),
      /Campaign join evidence|ENOENT/,
    );
    assert.equal(await stat(outputDir).then(() => true).catch(() => false), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
