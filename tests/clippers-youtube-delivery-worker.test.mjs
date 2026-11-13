import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { runYouTubeDeliveryWorker } from "../script/clippers-youtube-delivery-worker.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "youtube-delivery-"));
  await mkdir(path.join(root, "config"), { recursive: true });
  const configPath = path.join(root, "config", "delivery.json");
  await writeFile(configPath, `${JSON.stringify({ workspaceRoot: ".." })}\n`, { mode: 0o600 });
  await chmod(configPath, 0o600);
  return { root, configPath };
}

test("packages then publishes the exact produced reviewed queue and records exact URLs", async () => {
  const f = await fixture();
  const calls = [];
  try {
    const result = await runYouTubeDeliveryWorker({
      configPath: f.configPath,
      now: new Date("2026-08-24T10:30:00Z"),
      packageUploads: async () => { calls.push("package"); return { status: "completed", packaged: 1, queueFile: "youtube/reviewed-upload-queue.json" }; },
      publishUploads: async (options) => {
        calls.push(`publish:${options.queueFile}`);
        return { status: "completed", uploaded: 1, uncertain: 0, blocked: 0, queued: 1, blockers: [], items: [{ itemId: "one", lane: "motivation_es", status: "uploaded", privacyStatus: "public", youtubeUrl: "https://www.youtube.com/watch?v=abc123def" }] };
      },
    });
    assert.deepEqual(calls, ["package", "publish:youtube/reviewed-upload-queue.json"]);
    assert.equal(result.status, "completed");
    assert.equal(result.published, 1);
    assert.equal(result.publicUrls[0].youtubeUrl, "https://www.youtube.com/watch?v=abc123def");
    const stored = JSON.parse(await readFile(path.join(f.root, "reports/youtube-delivery-worker-latest.json"), "utf8"));
    assert.equal(stored.published, 1);
    assert.doesNotMatch(JSON.stringify(stored), /CLIENT_SECRET|REFRESH_TOKEN/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("never calls publisher when packaging throws or returns blockers", async () => {
  for (const mode of ["throw", "blocked"]) {
    const f = await fixture();
    let publishCalls = 0;
    try {
      const result = await runYouTubeDeliveryWorker({
        configPath: f.configPath,
        packageUploads: async () => {
          if (mode === "throw") throw new Error("source_report_missing_or_unsafe");
          return { status: "completed_with_blockers", blocked: [{ blocker: "qa_failed" }], queueFile: "youtube/reviewed-upload-queue.json" };
        },
        publishUploads: async () => { publishCalls += 1; },
      });
      assert.equal(result.status, "blocked");
      assert.equal(result.stage, "packaging");
      assert.equal(publishCalls, 0);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("preserves uncertain publish outcomes without claiming a URL", async () => {
  const f = await fixture();
  try {
    const result = await runYouTubeDeliveryWorker({
      configPath: f.configPath,
      packageUploads: async () => ({ status: "completed", packaged: 1, queueFile: "youtube/reviewed-upload-queue.json" }),
      publishUploads: async () => ({ status: "completed_with_uncertain_outcomes", uploaded: 0, uncertain: 1, blocked: 0, queued: 1, blockers: ["manual_youtube_reconciliation_required"], items: [{ status: "uncertain_outcome", youtubeUrl: "https://www.youtube.com/watch?v=notproof" }] }),
    });
    assert.equal(result.status, "completed_with_uncertain_outcomes");
    assert.equal(result.published, 0);
    assert.deepEqual(result.publicUrls, []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("active delivery lock blocks overlapping work", async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.root, "reports"), { recursive: true });
    await writeFile(path.join(f.root, "reports/youtube-delivery-worker.lock"), JSON.stringify({ pid: process.pid }));
    const result = await runYouTubeDeliveryWorker({ configPath: f.configPath, packageUploads: async () => assert.fail("must not package") });
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, ["youtube_delivery_worker_already_running"]);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("shell wrapper exports only the exact YouTube allowlist and never logs values", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "youtube-delivery-wrapper-"));
  try {
    await mkdir(path.join(root, "script"), { recursive: true });
    const capture = path.join(root, "capture.json");
    const config = path.join(root, "delivery.json");
    const selected = path.join(root, "selected.env");
    await writeFile(config, "{}\n", { mode: 0o600 });
    await writeFile(selected, [
      "CLIPPERS_YOUTUBE_ES_CHANNEL_ID=UCabcdefghijklmnopqrstuv",
      "CLIPPERS_YOUTUBE_ES_CLIENT_SECRET=super-secret-value",
      "CLIPPERS_YOUTUBE_ES_REFRESH_TOKEN='refresh-secret-value'",
      "CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED=true",
      "METRICOOL_USER_TOKEN=must-not-export",
      "UNRELATED_SECRET=must-not-export-either",
    ].join("\n"), { mode: 0o600 });
    await chmod(config, 0o600);
    await chmod(selected, 0o600);
    await writeFile(path.join(root, "script/clippers-youtube-delivery-worker.mjs"), `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(capture)}, JSON.stringify({channel:process.env.CLIPPERS_YOUTUBE_ES_CHANNEL_ID,clientSecret:process.env.CLIPPERS_YOUTUBE_ES_CLIENT_SECRET,refresh:process.env.CLIPPERS_YOUTUBE_ES_REFRESH_TOKEN,publish:process.env.CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED,metricool:process.env.METRICOOL_USER_TOKEN,unrelated:process.env.UNRELATED_SECRET,args:process.argv.slice(2)}));\n`);
    const wrapper = path.resolve("script/run-clippers-youtube-delivery-worker.sh");
    const result = spawnSync("zsh", [wrapper], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        UNRELATED_SECRET: "inherited-secret-must-also-be-scrubbed",
        CLIPPERS_RUNTIME_ROOT: root,
        CLIPPERS_YOUTUBE_DELIVERY_CONFIG: config,
        CLIPPERS_YOUTUBE_SELECTED_ENV: selected,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    const captured = JSON.parse(await readFile(capture, "utf8"));
    assert.equal(captured.channel, "UCabcdefghijklmnopqrstuv");
    assert.equal(captured.clientSecret, "super-secret-value");
    assert.equal(captured.refresh, "refresh-secret-value");
    assert.equal(captured.publish, "true");
    assert.equal(captured.metricool, undefined);
    assert.equal(captured.unrelated, undefined);
    assert.deepEqual(captured.args, ["--config", config]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
