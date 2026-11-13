#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runContentLearningCeo } from "./clippers-content-learning-ceo.mjs";
import { renderMotivationShort } from "./clippers-motivation-shorts.mjs";
import { buildQaSampleTimes, generateSleepVideo } from "./clippers-sleep-video-generator.mjs";

const LANGUAGES = ["es", "en"];
const DEFAULT_TIMEOUT_MS = 14 * 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINIMUM_SLEEP_SECONDS = 8 * 60 * 60;
const SHA256 = /^[a-f0-9]{64}$/i;
const execFileAsync = promisify(execFile);

const clean = (value) => String(value ?? "").trim();

async function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label}_json_invalid`);
    throw error;
  }
  return parsed;
}

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

function within(root, candidate, label) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, clean(candidate));
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label}_outside_workspace`);
  return resolved;
}

function validateConfig(config, configPath) {
  if (config?.schemaVersion !== 1) throw new Error("config_schema_version_invalid");
  const base = path.dirname(configPath);
  const workspaceRoot = path.resolve(base, clean(config.workspaceRoot));
  if (!clean(config.workspaceRoot)) throw new Error("workspace_root_required");
  const metricsLedgerPath = within(workspaceRoot, config.metricsLedger, "metrics_ledger");
  const reportDir = within(workspaceRoot, config.reportDir, "report_dir");
  const timeoutMs = Number(config.operationTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 60_000 || timeoutMs > MAX_TIMEOUT_MS) throw new Error("operation_timeout_invalid");
  const motivation = {};
  for (const language of LANGUAGES) {
    const lane = config?.motivation?.[language];
    if (!lane || !clean(lane.channelId)) throw new Error(`motivation_${language}_channel_required`);
    if (!Array.isArray(lane.manifestFiles)) throw new Error(`motivation_${language}_manifests_required`);
    if (lane.manifestFiles.length > 100) throw new Error(`motivation_${language}_manifest_limit_exceeded`);
    motivation[language] = {
      channelId: clean(lane.channelId),
      manifestFiles: [...new Set(lane.manifestFiles.map(clean).filter(Boolean))],
      gates: lane.gates || {},
    };
  }
  const sleep = config.sleep || {};
  const rawSleepJobs = sleep.enabled === true
    ? (Array.isArray(sleep.jobs) ? sleep.jobs : [sleep])
    : [];
  if (sleep.enabled === true && rawSleepJobs.length === 0) throw new Error("sleep_jobs_required");
  const sleepJobs = rawSleepJobs.map((job, index) => {
    for (const field of ["output", "visualSource", "visualSha256", "visualRightsEvidence", "title"]) {
      if (!clean(job?.[field])) throw new Error(`sleep_job_${index + 1}_${field}_required`);
    }
    return {
      outputPath: within(workspaceRoot, job.output, `sleep_job_${index + 1}_output`),
      visualSource: within(workspaceRoot, job.visualSource, `sleep_job_${index + 1}_visual`),
      visualRightsEvidence: within(workspaceRoot, job.visualRightsEvidence, `sleep_job_${index + 1}_visual_rights`),
      visualSha256: clean(job.visualSha256),
      title: clean(job.title),
      durationSeconds: Number(job.durationSeconds ?? 29_100),
      seed: Number(job.seed ?? 20_260_824 + index),
      adoptExisting: job.adoptExisting === true,
    };
  });
  if (new Set(sleepJobs.map((job) => job.outputPath)).size !== sleepJobs.length) throw new Error("sleep_job_outputs_must_be_unique");
  return {
    workspaceRoot, metricsLedgerPath, reportDir, timeoutMs, motivation,
    sleep: sleep.enabled === true ? { enabled: true, jobs: sleepJobs } : { enabled: false, jobs: [] },
    learning: config.learning || {},
  };
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export async function acquireWorkerLock(lockPath, now = new Date()) {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomUUID();
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, token, acquiredAt: now.toISOString() })}\n`);
      await handle.close();
      return { lockPath, token };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await readJson(lockPath, "worker_lock").catch(() => null);
      if (processAlive(Number(existing?.pid))) throw new Error("content_worker_already_running");
      await rm(lockPath, { force: true });
    }
  }
  throw new Error("content_worker_lock_unavailable");
}

async function releaseWorkerLock(lock) {
  const existing = await readJson(lock.lockPath, "worker_lock").catch(() => null);
  if (existing?.pid === process.pid && existing?.token === lock.token) await rm(lock.lockPath, { force: true });
}

async function withTimeout(task, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function candidateIdentity(workspaceRoot, manifestFile) {
  try {
    const manifestPath = within(workspaceRoot, manifestFile, "motivation_manifest");
    const info = await lstat(manifestPath);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    const manifest = await readJson(manifestPath, "motivation_manifest");
    return { channelId: clean(manifest?.channelId), language: clean(manifest?.language).toLowerCase() };
  } catch {
    return null;
  }
}

function recentSleepRows(ledger, now) {
  const rows = Array.isArray(ledger?.items) ? ledger.items : [];
  const cutoff = now.getTime() - 7 * DAY_MS;
  return rows.filter((row) => Number.isFinite(Date.parse(row?.generatedAt)) && Date.parse(row.generatedAt) > cutoff);
}

function dayInNewYork(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function reusableMotivationRows(ledger, { now, channelId, language, manifestFiles, limit }) {
  const today = dayInNewYork(now);
  const allowedManifests = new Set(manifestFiles.map(clean));
  return (Array.isArray(ledger?.items) ? ledger.items : [])
    .filter((row) => clean(row?.channelId) === clean(channelId)
      && clean(row?.language).toLowerCase() === language
      && allowedManifests.has(clean(row?.manifestFile))
      && dayInNewYork(row?.renderedAt) === today
      && clean(row?.outputFile)
      && SHA256.test(clean(row?.outputSha256)))
    .slice(0, limit)
    .map((row) => ({ status: "rendered", reusedExisting: true, ...row }));
}

async function nextSleepJob(jobs, ledger) {
  const used = new Set((Array.isArray(ledger?.items) ? ledger.items : [])
    .map((row) => clean(row?.outputPath)).filter(Boolean).map((filePath) => path.resolve(filePath)));
  for (const job of jobs) {
    if (used.has(job.outputPath)) continue;
    const artifacts = [job.outputPath, `${job.outputPath}.rights.json`, `${job.outputPath}.partial.mp4`];
    const exists = await Promise.all(artifacts.map((filePath) => lstat(filePath).then(() => true).catch(() => false)));
    if (job.adoptExisting && (exists[0] || exists[1] || exists[2])) return job;
    if (!exists.some(Boolean)) return job;
  }
  return null;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function safeWorkspaceFile(workspaceRoot, candidate, label) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedFile = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label}_outside_workspace`);
  const info = await lstat(resolvedFile).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`${label}_must_be_regular_file`);
  const [rootReal, fileReal] = await Promise.all([realpath(resolvedRoot), realpath(resolvedFile)]);
  const realRelative = path.relative(rootReal, fileReal);
  if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw new Error(`${label}_realpath_outside_workspace`);
  return resolvedFile;
}

function generatorQaSamplesValid(samples, durationSeconds) {
  const expectedTimes = buildQaSampleTimes(durationSeconds, false);
  if (!Array.isArray(samples) || samples.length !== expectedTimes.length) return false;
  return samples.every((sample, index) => Number.isFinite(Number(sample?.startSeconds))
    && Number(sample.startSeconds) === expectedTimes[index]
    && Number.isFinite(Number(sample?.sampleDuration))
    && Number(sample.sampleDuration) === Math.min(2, Math.max(0.25, durationSeconds - expectedTimes[index]))
    && Number.isFinite(Number(sample?.peakDb))
    && Number(sample.peakDb) < -0.1
    && Number.isFinite(Number(sample?.rmsDb))
    && Number(sample.rmsDb) > -60
    && /^[a-f0-9]{32}$/i.test(clean(sample?.frameMd5)));
}

async function defaultProbeExisting(mediaPath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", mediaPath,
  ], { maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout);
}

export async function adoptExistingSleepVideo({ workspaceRoot, job, probeExisting = defaultProbeExisting }) {
  if (job?.adoptExisting !== true) throw new Error("sleep_adoption_not_explicitly_enabled");
  const outputPath = await safeWorkspaceFile(workspaceRoot, job.outputPath, "sleep_adoption_output");
  const manifestPath = await safeWorkspaceFile(workspaceRoot, `${job.outputPath}.rights.json`, "sleep_adoption_manifest");
  const partialExists = await lstat(`${job.outputPath}.partial.mp4`).then(() => true).catch(() => false);
  if (partialExists) throw new Error("sleep_adoption_partial_artifact_present");
  const manifest = await readJson(manifestPath, "sleep_adoption_manifest");
  const outputHash = await sha256File(outputPath);
  if (!SHA256.test(clean(manifest?.output?.sha256)) || clean(manifest.output.sha256).toLowerCase() !== outputHash) {
    throw new Error("sleep_adoption_output_hash_mismatch");
  }
  const manifestOutput = await safeWorkspaceFile(workspaceRoot, manifest?.output?.path, "sleep_adoption_manifest_output");
  if (manifestOutput !== outputPath) throw new Error("sleep_adoption_manifest_output_mismatch");
  const visual = Array.isArray(manifest?.provenance?.externalVisualAssets)
    && manifest.provenance.externalVisualAssets.length === 1 ? manifest.provenance.externalVisualAssets[0] : null;
  const generatorPath = fileURLToPath(new URL("./clippers-sleep-video-generator.mjs", import.meta.url));
  const generatorHash = await sha256File(generatorPath);
  if (Number(manifest?.schemaVersion) !== 1
    || manifest?.artifactType !== "rights_verified_visual_with_procedural_rain_audio"
    || clean(manifest?.title) !== job.title
    || manifest?.provenance?.generator !== "script/clippers-sleep-video-generator.mjs"
    || clean(manifest?.provenance?.generatorSha256).toLowerCase() !== generatorHash
    || Number(manifest?.provenance?.seed) !== job.seed
    || Number(manifest?.provenance?.synthesisParameters?.seed) !== job.seed
    || Number(manifest?.provenance?.synthesisParameters?.durationSeconds) !== job.durationSeconds
    || clean(manifest?.provenance?.synthesisParametersSha256).toLowerCase() !== sha256Text(JSON.stringify(manifest?.provenance?.synthesisParameters))
    || !Array.isArray(manifest?.provenance?.externalAudioSamples) || manifest.provenance.externalAudioSamples.length !== 0
    || !Array.isArray(manifest?.provenance?.paidServicesUsed) || manifest.provenance.paidServicesUsed.length !== 0
    || manifest?.provenance?.networkAccessRequired !== false
    || manifest?.provenance?.generatedForTestingOnly !== false
    || !visual
    || manifest?.rights?.reviewRequiredBeforePublishing !== true
    || manifest?.rights?.publicationAuthorizedByThisManifest !== false
    || manifest?.qa?.status !== "passed"
    || manifest?.qa?.tool !== "ffprobe"
    || Number(manifest?.qa?.productionMinimumSeconds) < MINIMUM_SLEEP_SECONDS
    || Number(manifest?.output?.durationSeconds) !== job.durationSeconds
    || !generatorQaSamplesValid(manifest?.qa?.sampledMedia, Number(manifest?.output?.durationSeconds))) {
    throw new Error("sleep_adoption_generator_evidence_invalid");
  }
  const visualPath = await safeWorkspaceFile(workspaceRoot, visual.path, "sleep_adoption_visual");
  const evidencePath = await safeWorkspaceFile(workspaceRoot, visual.evidencePath, "sleep_adoption_visual_evidence");
  if (visualPath !== job.visualSource || evidencePath !== job.visualRightsEvidence
    || clean(visual.sha256).toLowerCase() !== clean(job.visualSha256).toLowerCase()
    || await sha256File(visualPath) !== clean(visual.sha256).toLowerCase()
    || await sha256File(evidencePath) !== clean(visual.evidenceSha256).toLowerCase()) {
    throw new Error("sleep_adoption_visual_provenance_mismatch");
  }
  const evidence = await readJson(evidencePath, "sleep_adoption_visual_evidence");
  if (Number(evidence?.schemaVersion) !== 1
    || evidence?.assetType !== "generated_original_visual"
    || clean(evidence?.sha256).toLowerCase() !== clean(visual.sha256).toLowerCase()
    || evidence?.rightsStatus !== "owned_generated_output"
    || evidence?.commercialUseAuthorized !== true
    || !Array.isArray(evidence?.thirdPartyAssets) || evidence.thirdPartyAssets.length !== 0
    || JSON.stringify(evidence) !== JSON.stringify(visual.evidence)) {
    throw new Error("sleep_adoption_visual_rights_invalid");
  }
  const probe = await probeExisting(outputPath);
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const durationSeconds = Number(probe?.format?.duration);
  if (!video || !audio || !clean(probe?.format?.format_name).includes("mp4")
    || !Number.isFinite(durationSeconds) || durationSeconds < MINIMUM_SLEEP_SECONDS
    || Number(video.width) <= Number(video.height)
    || Math.abs(durationSeconds - Number(manifest.output.durationSeconds)) > 1.5
    || Number(video.width) !== Number(manifest.output.width)
    || Number(video.height) !== Number(manifest.output.height)
    || clean(video.codec_name) !== clean(manifest.output.videoCodec)
    || clean(audio.codec_name) !== clean(manifest.output.audioCodec)
    || Number(audio.sample_rate) !== Number(manifest.output.audioSampleRate)
    || Number(audio.channels) !== Number(manifest.output.audioChannels)) {
    throw new Error("sleep_adoption_ffprobe_validation_failed");
  }
  return {
    outputPath,
    manifestPath,
    outputSha256: outputHash,
    durationSeconds,
    adoptedExisting: true,
    validation: "generator_manifest_hash_rights_qa_and_ffprobe_passed",
  };
}

export async function runContentLocalWorker({ configPath, now = new Date(), operations = {} }) {
  const resolvedConfig = path.resolve(configPath);
  const configInfo = await lstat(resolvedConfig);
  if (!configInfo.isFile() || configInfo.isSymbolicLink()) throw new Error("config_must_be_regular_file");
  const config = validateConfig(await readJson(resolvedConfig, "content_worker_config"), resolvedConfig);
  await stat(config.metricsLedgerPath);
  const lock = await acquireWorkerLock(path.join(config.reportDir, "clippers-content-local-worker.lock"), now);
  const reportPath = path.join(config.reportDir, "clippers-content-local-worker-latest.json");
  const sleepLedgerPath = path.join(config.reportDir, "clippers-content-sleep-ledger.json");
  const runCeo = operations.runCeo || runContentLearningCeo;
  const renderShort = operations.renderShort || renderMotivationShort;
  const generateSleep = operations.generateSleep || generateSleepVideo;
  const adoptSleep = operations.adoptSleep || adoptExistingSleepVideo;
  try {
    const shortChannels = Object.fromEntries(LANGUAGES.map((language) => {
      const lane = config.motivation[language];
      return [language, { ...lane.gates, eligibleCandidates: Math.min(5, lane.manifestFiles.length) }];
    }));
    const plan = await withTimeout(() => runCeo({
      ledgerPath: config.metricsLedgerPath,
      outputDir: config.reportDir,
      now,
      config: { ...config.learning, shortChannels },
    }), config.timeoutMs, "content_learning_ceo");
    const motivationLedger = await readJson(path.join(config.workspaceRoot, "reports", "clippers-motivation-ledger.json"), "motivation_ledger").catch((error) => {
      if (error?.code === "ENOENT") return { schemaVersion: 1, items: [] };
      throw error;
    });
    const motivation = {};
    for (const language of LANGUAGES) {
      const lanePlan = plan.dailyPlan.lanes.find((lane) => lane.lane === "motivation_short" && lane.language === language);
      const hardCap = Math.min(5, Math.max(0, Number(lanePlan?.target) || 0));
      const candidates = config.motivation[language].manifestFiles;
      const results = reusableMotivationRows(motivationLedger, {
        now,
        channelId: config.motivation[language].channelId,
        language,
        manifestFiles: candidates,
        limit: hardCap,
      });
      for (const manifestFile of candidates) {
        if (results.filter((result) => result?.status === "rendered").length >= hardCap) break;
        const identity = await candidateIdentity(config.workspaceRoot, manifestFile);
        if (!identity) {
          results.push({ status: "blocked", blockers: ["manifest_missing_or_unsafe"], manifestFile, apiCostUsd: 0, publishEnabled: false });
          continue;
        }
        if (identity.language !== language || identity.channelId !== config.motivation[language].channelId) {
          results.push({ status: "blocked", blockers: ["configured_channel_or_language_mismatch"], manifestFile, apiCostUsd: 0, publishEnabled: false });
          continue;
        }
        results.push(await withTimeout(() => renderShort({
          workspaceRoot: config.workspaceRoot, manifestFile, now,
        }), config.timeoutMs, `motivation_${language}`));
      }
      const rendered = results.filter((result) => result?.status === "rendered").length;
      const skippedDuplicates = results.filter((result) => result?.status === "duplicate").length;
      const reusedExisting = results.filter((result) => result?.reusedExisting === true).length;
      motivation[language] = {
        channelId: config.motivation[language].channelId,
        editorialTarget: 5,
        planned: hardCap,
        evaluatedCandidates: results.length,
        attempted: results.length - skippedDuplicates - reusedExisting,
        skippedDuplicates,
        reusedExisting,
        rendered,
        shortfall: 5 - rendered,
        results,
      };
    }
    const sleepPlan = plan.dailyPlan.lanes.find((lane) => lane.lane === "sleep_long");
    const sleepLedger = await readJson(sleepLedgerPath, "sleep_ledger").catch((error) => {
      if (error?.code === "ENOENT") return { schemaVersion: 1, items: [] };
      throw error;
    });
    const recent = recentSleepRows(sleepLedger, now);
    const sleepJob = recent.length ? null : await nextSleepJob(config.sleep.jobs, sleepLedger);
    let sleepResult = { status: "not_planned", blockers: [] };
    let attempted = 0;
    if (config.sleep.enabled && Number(sleepPlan?.target) > 0 && recent.length === 0 && sleepJob) {
      attempted = 1;
      const artifact = sleepJob.adoptExisting
        ? await withTimeout(() => adoptSleep({ workspaceRoot: config.workspaceRoot, job: sleepJob }), config.timeoutMs, "sleep_adoption")
        : await withTimeout(() => generateSleep({
          outputPath: sleepJob.outputPath,
          durationSeconds: sleepJob.durationSeconds,
          seed: sleepJob.seed,
          title: sleepJob.title,
          width: 1920,
          height: 1080,
          fps: 1,
          testMode: false,
          overwrite: false,
          visualSource: sleepJob.visualSource,
          visualSha256: sleepJob.visualSha256,
          visualRightsEvidence: sleepJob.visualRightsEvidence,
        }), config.timeoutMs, "sleep_generation");
      const entry = {
        generatedAt: now.toISOString(), outputPath: artifact.outputPath, manifestPath: artifact.manifestPath,
        ...(artifact.adoptedExisting ? { adoptedExisting: true, outputSha256: artifact.outputSha256, durationSeconds: artifact.durationSeconds, validation: artifact.validation } : {}),
      };
      await atomicJson(sleepLedgerPath, { schemaVersion: 1, items: [...(sleepLedger.items || []), entry] });
      sleepResult = { status: "generated", ...entry };
    } else if (recent.length) {
      const existingSleep = recent.at(-1);
      sleepResult = {
        status: "generated",
        reusedExisting: true,
        blockers: [],
        duplicateOf: existingSleep.outputPath,
        ...existingSleep,
      };
    } else if (config.sleep.enabled && Number(sleepPlan?.target) > 0 && !sleepJob) {
      sleepResult = { status: "blocked", blockers: ["sleep_job_queue_exhausted_or_artifact_exists"] };
    } else if (!config.sleep.enabled) {
      sleepResult = { status: "disabled", blockers: ["sleep_not_enabled_in_config"] };
    }
    const generated = sleepResult.status === "generated" ? 1 : 0;
    const requestedSleep = Math.min(1, Number(sleepPlan?.target) || 0);
    const effectiveSleepPlan = requestedSleep;
    const report = {
      schemaVersion: 1,
      runId: randomUUID(),
      generatedAt: now.toISOString(),
      status: Object.values(motivation).some((lane) => lane.shortfall > 0) || (effectiveSleepPlan > generated) ? "completed_with_shortfall" : "completed",
      networkUsed: false,
      uploadAttempted: false,
      publishEnabled: false,
      credentialsRead: false,
      apiCostUsd: 0,
      marketplaceAndTikTokIndependent: true,
      plan: { generatedAt: plan.generatedAt, lanes: plan.dailyPlan.lanes, experiments: plan.experiments },
      motivation,
      sleep: { requestedByCeo: requestedSleep, planned: effectiveSleepPlan, attempted, generated, shortfall: Math.max(0, effectiveSleepPlan - generated), result: sleepResult },
      blockers: [
        ...LANGUAGES.flatMap((language) => motivation[language].results
          .filter((result) => result?.status !== "duplicate")
          .flatMap((result) => result?.blockers || [])),
        ...(sleepResult.blockers || []),
      ],
    };
    await atomicJson(reportPath, report);
    return { ...report, reportPath };
  } finally {
    await releaseWorkerLock(lock);
  }
}

function cliValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const configPath = cliValue("config");
  if (!configPath) throw new Error("Usage: node script/clippers-content-local-worker.mjs --config /absolute/path/clippers-content-worker.json");
  const result = await runContentLocalWorker({ configPath });
  process.stdout.write(`${JSON.stringify({ status: result.status, reportPath: result.reportPath }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
