import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireWorkerLock, adoptExistingSleepVideo, runContentLocalWorker } from "../script/clippers-content-local-worker.mjs";
import { runContentLearningCeo } from "../script/clippers-content-learning-ceo.mjs";

const NOW = new Date("2026-08-24T14:00:00.000Z");
const DAY_MS_FOR_TEST = 86_400_000;

async function fixture({ es = 5, en = 5, sleep = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "content-worker-"));
  const reports = path.join(root, "reports", "content-worker");
  await mkdir(path.join(root, "manifests"), { recursive: true });
  await mkdir(reports, { recursive: true });
  await writeFile(path.join(root, "metrics.json"), JSON.stringify({ entries: [] }));
  const manifests = { es: [], en: [] };
  for (const language of ["es", "en"]) {
    const count = language === "es" ? es : en;
    for (let index = 0; index < count; index += 1) {
      const relative = `manifests/${language}-${index}.json`;
      await writeFile(path.join(root, relative), JSON.stringify({ channelId: `motivation-${language}`, language }));
      manifests[language].push(relative);
    }
  }
  const config = {
    schemaVersion: 1,
    workspaceRoot: root,
    metricsLedger: "metrics.json",
    reportDir: "reports/content-worker",
    operationTimeoutMs: 60_000,
    motivation: {
      es: { channelId: "motivation-es", manifestFiles: manifests.es, gates: { accountVerified: true, rightsStatus: "owned", qualityPassed: true, candidatesReady: true } },
      en: { channelId: "motivation-en", manifestFiles: manifests.en, gates: { accountVerified: true, rightsStatus: "owned", qualityPassed: true, candidatesReady: true } },
    },
    learning: { laneGates: { sleep_long: { accountVerified: true, rightsStatus: "owned", qualityPassed: true, candidatesReady: true } } },
    sleep: sleep ? {
      enabled: true,
      jobs: [1, 2].map((number) => ({
        output: `sleep/output-${number}.mp4`,
        durationSeconds: 29_100,
        seed: number,
        title: `Rain for sleep ${number}`,
        visualSource: "sleep/source.png",
        visualSha256: "a".repeat(64),
        visualRightsEvidence: "sleep/source.rights.json",
      })),
    } : { enabled: false },
  };
  const configPath = path.join(root, "config.json");
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  return { root, reports, configPath };
}

function operations(calls) {
  return {
    runCeo: runContentLearningCeo,
    renderShort: async ({ manifestFile }) => {
      calls.shorts.push(manifestFile);
      return { status: "rendered", shortId: path.basename(manifestFile, ".json"), publishEnabled: false, apiCostUsd: 0 };
    },
    generateSleep: async (options) => {
      calls.sleep.push(options);
      return { outputPath: options.outputPath, manifestPath: `${options.outputPath}.rights.json` };
    },
  };
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function approvedExistingSleep(item) {
  const config = JSON.parse(await readFile(item.configPath, "utf8"));
  config.sleep.jobs = [config.sleep.jobs[0]];
  config.sleep.jobs[0].adoptExisting = true;
  const job = config.sleep.jobs[0];
  const outputPath = path.join(item.root, job.output);
  const visualPath = path.join(item.root, job.visualSource);
  const evidencePath = path.join(item.root, job.visualRightsEvidence);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.dirname(visualPath), { recursive: true });
  const media = Buffer.from("approved-eight-hour-master");
  const visual = Buffer.from("owned-generated-visual");
  await writeFile(outputPath, media);
  await writeFile(visualPath, visual);
  job.visualSha256 = sha256(visual);
  const evidence = {
    schemaVersion: 1,
    assetType: "generated_original_visual",
    sha256: job.visualSha256,
    rightsStatus: "owned_generated_output",
    commercialUseAuthorized: true,
    thirdPartyAssets: [],
  };
  await writeFile(evidencePath, JSON.stringify(evidence));
  const evidenceHash = sha256(JSON.stringify(evidence));
  const synthesisParameters = { seed: job.seed, durationSeconds: job.durationSeconds };
  const generatorHash = sha256(await readFile(new URL("../script/clippers-sleep-video-generator.mjs", import.meta.url)));
  const manifest = {
    schemaVersion: 1,
    artifactType: "rights_verified_visual_with_procedural_rain_audio",
    title: job.title,
    output: {
      path: outputPath,
      sha256: sha256(media),
      durationSeconds: 29_100,
      width: 1920,
      height: 1080,
      videoCodec: "h264",
      audioCodec: "aac",
      audioSampleRate: 48_000,
      audioChannels: 2,
    },
    provenance: {
      generator: "script/clippers-sleep-video-generator.mjs",
      generatorSha256: generatorHash,
      seed: job.seed,
      synthesisParameters,
      synthesisParametersSha256: sha256(JSON.stringify(synthesisParameters)),
      externalAudioSamples: [],
      paidServicesUsed: [],
      networkAccessRequired: false,
      generatedForTestingOnly: false,
      externalVisualAssets: [{
        path: visualPath,
        sha256: job.visualSha256,
        evidencePath,
        evidenceSha256: evidenceHash,
        evidence,
      }],
    },
    rights: { reviewRequiredBeforePublishing: true, publicationAuthorizedByThisManifest: false },
    qa: {
      status: "passed",
      tool: "ffprobe",
      productionMinimumSeconds: 28_800,
      sampledMedia: [0, 3_600, 7_200, 10_800, 14_400, 18_000, 21_600, 25_200, 28_800, 29_098].map((startSeconds, index) => ({
        startSeconds, sampleDuration: 2, peakDb: -20 - index, rmsDb: -30 - index, frameMd5: ((index + 1) % 16).toString(16).repeat(32),
      })),
    },
  };
  await writeFile(`${outputPath}.rights.json`, JSON.stringify(manifest));
  await writeFile(item.configPath, JSON.stringify(config), { mode: 0o600 });
  const probeExisting = async () => ({
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
      { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 },
    ],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "29100.000000" },
  });
  return { config, job, outputPath, probeExisting };
}

test("cold start prepares five independent candidates per channel and never uploads", async () => {
  const item = await fixture();
  const calls = { shorts: [], sleep: [] };
  const result = await runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: operations(calls) });
  assert.deepEqual({ es: result.motivation.es.rendered, en: result.motivation.en.rendered }, { es: 5, en: 5 });
  assert.deepEqual({ es: result.motivation.es.shortfall, en: result.motivation.en.shortfall }, { es: 0, en: 0 });
  assert.equal(calls.shorts.length, 10);
  assert.ok(result.plan.lanes.filter((lane) => lane.lane === "motivation_short").every((lane) => lane.action === "cold_start_controlled"));
  assert.equal(result.plan.experiments.length, 0);
  assert.equal(result.networkUsed, false);
  assert.equal(result.uploadAttempted, false);
  assert.equal(result.publishEnabled, false);
  assert.equal(result.credentialsRead, false);
  assert.equal(result.apiCostUsd, 0);
  assert.equal((await stat(result.reportPath)).mode & 0o777, 0o600);
});

test("rerun preserves same-day rendered motivation evidence for packager consumption", async () => {
  const item = await fixture({ es: 5, en: 5, sleep: false });
  const renderedRows = [];
  for (const language of ["es", "en"]) {
    for (let index = 0; index < 5; index += 1) {
      renderedRows.push({
        shortId: `${language}-${index}`,
        channelId: `motivation-${language}`,
        language,
        renderedAt: NOW.toISOString(),
        manifestFile: `manifests/${language}-${index}.json`,
        manifestSha256: `${index}`.repeat(64).slice(0, 64),
        outputFile: `rendered/${language}-${index}.mp4`,
        outputSha256: `${index + 1}`.repeat(64).slice(0, 64),
        rights: { script: "owned_original", audio: "owned_original_procedural", thirdPartyMaterial: false },
        apiCostUsd: 0,
        publishEnabled: false,
      });
    }
  }
  await writeFile(path.join(item.root, "reports", "clippers-motivation-ledger.json"), JSON.stringify({ schemaVersion: 1, items: renderedRows }));
  const result = await runContentLocalWorker({
    configPath: item.configPath,
    now: NOW,
    operations: {
      runCeo: runContentLearningCeo,
      renderShort: async () => assert.fail("same-day rendered evidence must be reused instead of rerendered"),
      generateSleep: async () => assert.fail("sleep is disabled"),
    },
  });
  assert.equal(result.status, "completed_with_shortfall");
  assert.deepEqual({ es: result.motivation.es.rendered, en: result.motivation.en.rendered }, { es: 5, en: 5 });
  assert.deepEqual({ es: result.motivation.es.shortfall, en: result.motivation.en.shortfall }, { es: 0, en: 0 });
  assert.deepEqual({ es: result.motivation.es.reusedExisting, en: result.motivation.en.reusedExisting }, { es: 5, en: 5 });
  assert.deepEqual({ es: result.motivation.es.attempted, en: result.motivation.en.attempted }, { es: 0, en: 0 });
  assert.equal(result.motivation.es.results[0].status, "rendered");
  assert.equal(result.motivation.es.results[0].reusedExisting, true);
});

test("reports exact per-channel shortfall from eligible manifests", async () => {
  const item = await fixture({ es: 3, en: 1, sleep: false });
  const calls = { shorts: [], sleep: [] };
  const result = await runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: operations(calls) });
  assert.deepEqual({ planned: result.motivation.es.planned, rendered: result.motivation.es.rendered, shortfall: result.motivation.es.shortfall }, { planned: 3, rendered: 3, shortfall: 2 });
  assert.deepEqual({ planned: result.motivation.en.planned, rendered: result.motivation.en.rendered, shortfall: result.motivation.en.shortfall }, { planned: 1, rendered: 1, shortfall: 4 });
  assert.equal(result.status, "completed_with_shortfall");
});

test("day two skips the first five duplicates and rotates to the next five candidates", async () => {
  const item = await fixture({ es: 10, en: 0, sleep: false });
  const rendered = new Set();
  const rotatingOperations = {
    runCeo: runContentLearningCeo,
    renderShort: async ({ manifestFile }) => {
      if (rendered.has(manifestFile)) return { status: "duplicate", blockers: ["already_rendered"], shortId: manifestFile };
      rendered.add(manifestFile);
      return { status: "rendered", shortId: manifestFile, publishEnabled: false, apiCostUsd: 0 };
    },
    generateSleep: async () => assert.fail("sleep must remain disabled"),
  };
  const first = await runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: rotatingOperations });
  assert.equal(first.motivation.es.rendered, 5);
  assert.deepEqual([...rendered], Array.from({ length: 5 }, (_, index) => `manifests/es-${index}.json`));
  const second = await runContentLocalWorker({ configPath: item.configPath, now: new Date(NOW.getTime() + 86_400_000), operations: rotatingOperations });
  assert.equal(second.motivation.es.rendered, 5);
  assert.equal(second.motivation.es.skippedDuplicates, 5);
  assert.equal(second.motivation.es.attempted, 5);
  assert.equal(second.motivation.es.shortfall, 0);
  assert.deepEqual([...rendered], Array.from({ length: 10 }, (_, index) => `manifests/es-${index}.json`));
  assert.ok(!second.blockers.includes("already_rendered"));
});

test("blocks a manifest assigned to the wrong independent channel before render", async () => {
  const item = await fixture({ es: 1, en: 0, sleep: false });
  await writeFile(path.join(item.root, "manifests", "es-0.json"), JSON.stringify({ channelId: "motivation-en", language: "en" }));
  const calls = { shorts: [], sleep: [] };
  const result = await runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: operations(calls) });
  assert.equal(calls.shorts.length, 0);
  assert.deepEqual(result.motivation.es.results[0].blockers, ["configured_channel_or_language_mismatch"]);
});

test("generates sleep once per rolling seven days and reuses it in a second report", async () => {
  const item = await fixture({ es: 0, en: 0 });
  const firstCalls = { shorts: [], sleep: [] };
  const first = await runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: operations(firstCalls) });
  assert.equal(first.sleep.generated, 1);
  assert.equal(firstCalls.sleep.length, 1);
  assert.equal(firstCalls.sleep[0].durationSeconds, 29_100);
  assert.equal(firstCalls.sleep[0].visualSha256, "a".repeat(64));
  const secondCalls = { shorts: [], sleep: [] };
  const second = await runContentLocalWorker({ configPath: item.configPath, now: new Date(NOW.getTime() + 2 * 86_400_000), operations: operations(secondCalls) });
  assert.equal(second.sleep.generated, 1);
  assert.equal(second.sleep.requestedByCeo, 1);
  assert.equal(second.sleep.planned, 1);
  assert.equal(second.sleep.shortfall, 0);
  assert.equal(second.sleep.result.status, "generated");
  assert.equal(second.sleep.result.reusedExisting, true);
  assert.equal(secondCalls.sleep.length, 0);
  const nextWeekCalls = { shorts: [], sleep: [] };
  const nextWeek = await runContentLocalWorker({ configPath: item.configPath, now: new Date(NOW.getTime() + 8 * 86_400_000), operations: operations(nextWeekCalls) });
  assert.equal(nextWeek.sleep.generated, 1);
  assert.equal(nextWeek.sleep.shortfall, 0);
  assert.equal(nextWeekCalls.sleep.length, 1);
  assert.match(nextWeekCalls.sleep[0].outputPath, /output-2\.mp4$/);
});

test("a live PID lock remains authoritative regardless of age", async () => {
  const item = await fixture();
  const lockPath = path.join(item.reports, "lock.json");
  await writeFile(lockPath, JSON.stringify({ pid: process.pid, token: "old", acquiredAt: "2001-01-01T00:00:00Z" }), { mode: 0o600 });
  await assert.rejects(acquireWorkerLock(lockPath, NOW), /content_worker_already_running/);
  assert.equal(JSON.parse(await readFile(lockPath, "utf8")).token, "old");
});

test("rejects unsafe workspace escapes", async () => {
  const item = await fixture();
  const config = JSON.parse(await readFile(item.configPath, "utf8"));
  config.reportDir = "../outside";
  await writeFile(item.configPath, JSON.stringify(config));
  await assert.rejects(runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: operations({ shorts: [], sleep: [] }) }), /report_dir_outside_workspace/);
});

test("rejects a sleep job output that escapes the workspace", async () => {
  const item = await fixture();
  const config = JSON.parse(await readFile(item.configPath, "utf8"));
  config.sleep.jobs[0].output = "../outside.mp4";
  await writeFile(item.configPath, JSON.stringify(config));
  await assert.rejects(
    runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: operations({ shorts: [], sleep: [] }) }),
    /sleep_job_1_output_outside_workspace/,
  );
});

test("rejects duplicate sleep job outputs before generation", async () => {
  const item = await fixture();
  const config = JSON.parse(await readFile(item.configPath, "utf8"));
  config.sleep.jobs[1].output = config.sleep.jobs[0].output;
  await writeFile(item.configPath, JSON.stringify(config));
  await assert.rejects(
    runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: operations({ shorts: [], sleep: [] }) }),
    /sleep_job_outputs_must_be_unique/,
  );
});

test("an orphaned first sleep artifact rotates to the next job without overwrite", async () => {
  const item = await fixture({ es: 0, en: 0 });
  await mkdir(path.join(item.root, "sleep"), { recursive: true });
  const orphanPath = path.join(item.root, "sleep", "output-1.mp4");
  await writeFile(orphanPath, "preserve-me");
  const calls = { shorts: [], sleep: [] };
  const result = await runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: operations(calls) });
  assert.equal(result.sleep.generated, 1);
  assert.equal(calls.sleep.length, 1);
  assert.match(calls.sleep[0].outputPath, /output-2\.mp4$/);
  assert.equal(calls.sleep[0].overwrite, false);
  assert.equal(await readFile(orphanPath, "utf8"), "preserve-me");
});

test("explicitly adopts a rights-verified existing master into a packager-compatible report and rolling ledger", async () => {
  const item = await fixture({ es: 0, en: 0 });
  const approved = await approvedExistingSleep(item);
  const calls = { shorts: [], sleep: [] };
  const adoptSleep = (options) => adoptExistingSleepVideo({ ...options, probeExisting: approved.probeExisting });
  const first = await runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: { ...operations(calls), adoptSleep } });
  assert.equal(calls.sleep.length, 0, "adoption must not rerender");
  assert.equal(first.sleep.generated, 1);
  assert.equal(first.sleep.result.status, "generated", "upload packager consumes generated sleep rows");
  assert.equal(first.sleep.result.adoptedExisting, true);
  assert.equal(first.sleep.result.outputPath, approved.outputPath);
  assert.match(first.sleep.result.outputSha256, /^[a-f0-9]{64}$/);
  assert.equal(first.sleep.result.durationSeconds, 29_100);
  assert.equal(first.networkUsed, false);
  assert.equal(first.uploadAttempted, false);
  assert.equal(first.apiCostUsd, 0);
  const ledger = JSON.parse(await readFile(path.join(item.reports, "clippers-content-sleep-ledger.json"), "utf8"));
  assert.equal(ledger.items[0].adoptedExisting, true);
  const second = await runContentLocalWorker({
    configPath: item.configPath,
    now: new Date(NOW.getTime() + DAY_MS_FOR_TEST),
    operations: { ...operations({ shorts: [], sleep: [] }), adoptSleep },
  });
  assert.equal(second.sleep.result.status, "generated");
  assert.equal(second.sleep.result.reusedExisting, true);
  assert.equal(second.sleep.generated, 1);
});

test("existing sleep artifact without explicit adoption remains fail-closed", async () => {
  const item = await fixture({ es: 0, en: 0 });
  const config = JSON.parse(await readFile(item.configPath, "utf8"));
  config.sleep.jobs = [config.sleep.jobs[0]];
  await writeFile(item.configPath, JSON.stringify(config));
  const outputPath = path.join(item.root, config.sleep.jobs[0].output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, "orphan-must-not-be-adopted");
  const calls = { shorts: [], sleep: [] };
  const result = await runContentLocalWorker({ configPath: item.configPath, now: NOW, operations: operations(calls) });
  assert.equal(calls.sleep.length, 0);
  assert.equal(result.sleep.result.status, "blocked");
  assert.deepEqual(result.sleep.result.blockers, ["sleep_job_queue_exhausted_or_artifact_exists"]);
});

test("adoption rejects a modified master hash before probing", async () => {
  const item = await fixture({ es: 0, en: 0 });
  const approved = await approvedExistingSleep(item);
  await writeFile(approved.outputPath, "modified-after-approval");
  let probed = false;
  await assert.rejects(adoptExistingSleepVideo({
    workspaceRoot: item.root,
    job: { ...approved.job, outputPath: approved.outputPath, visualSource: path.join(item.root, approved.job.visualSource), visualRightsEvidence: path.join(item.root, approved.job.visualRightsEvidence) },
    probeExisting: async () => { probed = true; return approved.probeExisting(); },
  }), /sleep_adoption_output_hash_mismatch/);
  assert.equal(probed, false);
});

test("adoption requires the manifest to pin the exact local generator", async () => {
  const item = await fixture({ es: 0, en: 0 });
  const approved = await approvedExistingSleep(item);
  const manifestPath = `${approved.outputPath}.rights.json`;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.provenance.generatorSha256 = "b".repeat(64);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(adoptExistingSleepVideo({
    workspaceRoot: item.root,
    job: { ...approved.job, outputPath: approved.outputPath, visualSource: path.join(item.root, approved.job.visualSource), visualRightsEvidence: path.join(item.root, approved.job.visualRightsEvidence) },
    probeExisting: approved.probeExisting,
  }), /sleep_adoption_generator_evidence_invalid/);
});

test("adoption requires every hourly and final generator QA sample", async () => {
  const item = await fixture({ es: 0, en: 0 });
  const approved = await approvedExistingSleep(item);
  const manifestPath = `${approved.outputPath}.rights.json`;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.qa.sampledMedia.splice(4, 1);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(adoptExistingSleepVideo({
    workspaceRoot: item.root,
    job: { ...approved.job, outputPath: approved.outputPath, visualSource: path.join(item.root, approved.job.visualSource), visualRightsEvidence: path.join(item.root, approved.job.visualRightsEvidence) },
    probeExisting: approved.probeExisting,
  }), /sleep_adoption_generator_evidence_invalid/);
});

test("adoption rejects symlinked media even when it points inside the workspace", async () => {
  const item = await fixture({ es: 0, en: 0 });
  const approved = await approvedExistingSleep(item);
  const target = `${approved.outputPath}.target`;
  await writeFile(target, await readFile(approved.outputPath));
  await rm(approved.outputPath);
  await symlink(target, approved.outputPath);
  await assert.rejects(adoptExistingSleepVideo({
    workspaceRoot: item.root,
    job: { ...approved.job, outputPath: approved.outputPath, visualSource: path.join(item.root, approved.job.visualSource), visualRightsEvidence: path.join(item.root, approved.job.visualRightsEvidence) },
    probeExisting: approved.probeExisting,
  }), /sleep_adoption_output_must_be_regular_file/);
});
