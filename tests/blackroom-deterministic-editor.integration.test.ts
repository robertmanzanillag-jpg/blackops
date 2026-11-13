import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { buildBlackRoomLocalEditorArgs } from "../server/blackroom-local-worker";

const execFileAsync = promisify(execFile);

test("paused local editor performs no media work and removes stale temporary fragments", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "blackroom-editor-paused-"));
  const agentDir = path.join(project, "clippers_workspace/blackroom/agent");
  const staleDirectory = path.join(agentDir, "editor-tmp/stale-run");
  await mkdir(staleDirectory, { recursive: true });
  const sourceDir = path.join(project, "clippers_workspace/blackroom/sources");
  const renderDir = path.join(project, "clippers_workspace/blackroom/rendered");
  await mkdir(sourceDir, { recursive: true });
  await mkdir(renderDir, { recursive: true });
  const orphan = path.join(renderDir, "blackroom-tiktok-orphan.mp4");
  const preserved = path.join(renderDir, "blackroom-tiktok-preserved.mp4");
  await writeFile(orphan, "orphan");
  await writeFile(preserved, "reserved");
  await writeFile(path.join(staleDirectory, "large-video.part"), "stale");
  await writeFile(path.join(agentDir, "queue.json"), JSON.stringify({ enabled: false }));
  await writeFile(path.join(agentDir, "worker-ledger.json"), JSON.stringify({
    version: 1,
    entries: [{ sourcePath: path.join(sourceDir, "missing-source.mp4"), renderPath: preserved }],
  }));
  await execFileAsync(process.execPath, buildBlackRoomLocalEditorArgs(process.cwd()), {
    cwd: process.cwd(),
    env: { ...process.env, BLACKROOM_PROJECT_DIR: project },
  });
  await assert.rejects(access(staleDirectory));
  await assert.rejects(access(orphan));
  await access(preserved);
  assert.deepEqual(await readdir(path.join(project, "clippers_workspace/blackroom/sources")), []);
  assert.deepEqual(await readdir(path.join(project, "clippers_workspace/blackroom/rendered")), ["blackroom-tiktok-preserved.mp4"]);
});

test("native BlackRoom ledger runner reserves a clip without tsx or esbuild", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "blackroom-ledger-native-"));
  const agentDir = path.join(project, "clippers_workspace/blackroom/agent");
  const renderDir = path.join(project, "clippers_workspace/blackroom/rendered");
  const sourceDir = path.join(project, "clippers_workspace/blackroom/sources");
  await mkdir(agentDir, { recursive: true });
  await mkdir(renderDir, { recursive: true });
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(agentDir, "queue.json"), JSON.stringify({ sourceHistory: [] }));
  const renderPath = path.join(renderDir, "blackroom-tiktok-native.mp4");
  const sourcePath = path.join(sourceDir, "blackroom-native-source.mp4");
  await writeFile(renderPath, "render");
  await writeFile(sourcePath, "source");
  const repository = process.cwd();
  await execFileAsync(process.execPath, [
    "--experimental-strip-types", "--import", path.join(repository, "script/register-native-typescript.mjs"),
    path.join(repository, "script/blackroom-worker-ledger.ts"), "--reserve",
    "--job", "native-job", "--slot", "12:30", "--video", "native-video", "--dj", "Native DJ",
    "--language", "en", "--format", "vertical", "--duration", "15",
    "--segment-start", "10", "--segment-end", "25", "--caption", "Native reservation",
    "--render", renderPath, "--source", sourcePath,
  ], { cwd: project });
  const ledger = JSON.parse(await readFile(path.join(agentDir, "worker-ledger.json"), "utf8"));
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.entries[0].status, "reserved");
  assert.equal(ledger.entries[0].videoId, "native-video");
});
