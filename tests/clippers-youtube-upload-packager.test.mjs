import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { packageYouTubeUploads } from "../script/clippers-youtube-upload-packager.mjs";

const NOW = new Date("2026-08-24T16:00:00.000Z");
const sha = (value) => createHash("sha256").update(value).digest("hex");

function fakeMediaCommands({ decodeFails = false, sleep = false } = {}) {
  const calls = [];
  return {
    calls,
    runCommand: async (command, args) => {
      calls.push({ command, args });
      if (command === "ffmpeg" && decodeFails) throw new Error("decode error");
      if (command === "ffprobe") return { stdout: JSON.stringify({
        streams: [
          { codec_type: "video", codec_name: "h264", width: sleep ? 1920 : 1080, height: sleep ? 1080 : 1920, pix_fmt: "yuv420p" },
          { codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000" },
        ],
        format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: sleep ? "29100" : "26" },
      }) };
      return { stdout: "", stderr: "" };
    },
  };
}

async function fixture({ motivationCount = 1, includeSleep = false, privacy = "private", publicAuth = null, auditVerified = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "youtube-packager-"));
  await Promise.all(["reports/content-worker", "reports", "media", "manifests", "evidence/motivation", "sleep"].map((dir) => mkdir(path.join(root, dir), { recursive: true })));
  const report = {
    schemaVersion: 1, status: "completed", motivation: { es: { results: [] }, en: { results: [] } },
    sleep: { result: { status: "not_planned" } },
  };
  for (let index = 0; index < motivationCount; index += 1) {
    const shortId = `motiva-${index + 1}`;
    const manifestFile = `manifests/${shortId}.json`;
    const mediaFile = `media/${shortId}.mp4`;
    const provenanceFile = `evidence/motivation/${shortId}/provenance.json`;
    const media = Buffer.from(`valid-motivation-${index}`);
    const mediaHash = sha(media);
    const manifest = {
      schemaVersion: 1, shortId, channelId: "motivation-es", language: "es", topic: "disciplina",
      script: {
        hook: `La disciplina empieza hoy ${index + 1}`,
        beats: ["Haz una acción pequeña y repítela mañana."], close: "Empieza ahora.",
        originality: { status: "owned_original", author: "Equipo Clippers", thirdPartyQuotes: false, thirdPartySpeeches: false, sources: [] },
      },
      audio: { mode: "procedural_original", provenance: { status: "owned_original", generator: "ffmpeg_lavfi_anoisesrc_v1", thirdPartyAssets: false, networkUsed: false, paidCostUsd: 0 } },
    };
    await mkdir(path.dirname(path.join(root, provenanceFile)), { recursive: true });
    await writeFile(path.join(root, mediaFile), media);
    await writeFile(path.join(root, manifestFile), JSON.stringify(manifest));
    const row = {
      status: "rendered", shortId, outputFile: mediaFile, outputSha256: mediaHash,
      manifestFile, manifestSha256: sha(await readFile(path.join(root, manifestFile))),
      audioMode: "procedural_original", rights: { script: "owned_original", audio: "owned_original_procedural", thirdPartyMaterial: false },
      evidenceFrames: [{ file: `evidence/motivation/${shortId}/start.jpg` }],
    };
    await writeFile(path.join(root, provenanceFile), JSON.stringify({ schemaVersion: 1, ...row }));
    report.motivation.es.results.push(row);
  }
  if (includeSleep) {
    const outputPath = path.join(root, "sleep", "rain-8h.mp4");
    const media = Buffer.from("valid-sleep-media");
    const mediaHash = sha(media);
    await writeFile(outputPath, media);
    const manifestPath = `${outputPath}.rights.json`;
    const manifest = {
      schemaVersion: 1, artifactType: "rights_verified_visual_with_procedural_rain_audio", title: "Lluvia Nocturna — 8 Horas para Dormir",
      output: { path: outputPath, sha256: mediaHash },
      provenance: {
        externalAudioSamples: [], paidServicesUsed: [], networkAccessRequired: false, generatedForTestingOnly: false,
        generator: "script/clippers-sleep-video-generator.mjs",
        externalVisualAssets: [{ sha256: "a".repeat(64), evidenceSha256: "b".repeat(64), evidence: { rightsStatus: "owned_generated_output", commercialUseAuthorized: true, thirdPartyAssets: [] } }],
      },
      rights: { reviewRequiredBeforePublishing: true, publicationAuthorizedByThisManifest: false }, qa: { status: "passed" },
    };
    await writeFile(manifestPath, JSON.stringify(manifest));
    report.sleep.result = { status: "generated", outputPath, manifestPath };
  }
  const sourceReport = "reports/content-worker/clippers-content-local-worker-latest.json";
  await writeFile(path.join(root, sourceReport), JSON.stringify(report));
  const config = {
    schemaVersion: 1, workspaceRoot: root, sourceReport,
    authorization: {
      blanketAuthorized: true, authorizedBy: "Robert", authorizedAt: "2026-08-24T15:00:00.000Z",
      privacyPolicyAccepted: true, privacyPolicyVersion: "2026-08-26",
      privacyPolicyAcceptedBy: "Robert", privacyPolicyAcceptedAt: "2026-08-26T05:00:00.000Z",
      motivationShortsPerDayPerChannel: 5, sleepVideosPerRollingSevenDays: 1,
      youtubeApiProjectAuditVerified: auditVerified,
    },
    channels: {
      motivation_es: { channelId: "UC1234567890123456789012", privacyStatus: privacy, madeForKids: false, ...(publicAuth ? { publicAuthorization: publicAuth } : {}) },
      motivation_en: { channelId: "UCabcdefghijklmnopqrstuv", privacyStatus: "private", madeForKids: false },
      sleep: { channelId: "UCZYXWVUTSRQPONMLKJIHGFE", privacyStatus: privacy, madeForKids: false, ...(publicAuth ? { publicAuthorization: publicAuth } : {}) },
    },
  };
  const configPath = path.join(root, "packager-config.json");
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  return { root, report, config, configPath, sourceReport };
}

test("packages owned procedural motivation with full-decode QA and native metadata", async () => {
  const item = await fixture();
  const commands = fakeMediaCommands();
  const result = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: commands });
  assert.equal(result.status, "completed");
  assert.equal(result.packaged, 1);
  const queue = JSON.parse(await readFile(path.join(item.root, result.queueFile), "utf8"));
  assert.equal(queue.reviewedBy, "Robert");
  assert.equal(queue.items.length, 1);
  const uploadItem = JSON.parse(await readFile(path.join(item.root, queue.items[0].itemFile), "utf8"));
  assert.match(uploadItem.description, /Motivación/);
  assert.equal(uploadItem.privacyStatus, "private");
  assert.equal(uploadItem.madeForKids, false);
  assert.equal(queue.items[0].madeForKids, false);
  assert.deepEqual(uploadItem.privacyPolicyAcceptance, {
    accepted: true, version: "2026-08-26", acceptedBy: "Robert", acceptedAt: "2026-08-26T05:00:00.000Z",
  });
  assert.deepEqual(queue.items[0].privacyPolicyAcceptance, uploadItem.privacyPolicyAcceptance);
  assert.deepEqual(queue.authorization.privacyPolicyAcceptance, uploadItem.privacyPolicyAcceptance);
  const rights = JSON.parse(await readFile(path.join(item.root, uploadItem.rightsEvidence.file), "utf8"));
  assert.equal(rights.sourceProvenance.proceduralAudioGenerator, "ffmpeg_lavfi_anoisesrc_v1");
  const qa = JSON.parse(await readFile(path.join(item.root, uploadItem.qaEvidence.file), "utf8"));
  assert.equal(qa.checks.playbackComplete, true);
  assert.ok(commands.calls.some((call) => call.command === "ffmpeg" && call.args.includes("-f") && call.args.includes("null")));
  assert.equal((await stat(path.join(item.root, queue.items[0].itemFile))).mode & 0o777, 0o600);
});

test("packages a production sleep artifact only from its SHA-linked rights manifest", async () => {
  const item = await fixture({ motivationCount: 0, includeSleep: true });
  const result = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands({ sleep: true }) });
  assert.equal(result.packaged, 1);
  assert.equal(result.items[0].lane, "sleep");
  const queue = JSON.parse(await readFile(path.join(item.root, result.queueFile), "utf8"));
  const uploadItem = JSON.parse(await readFile(path.join(item.root, queue.items[0].itemFile), "utf8"));
  assert.match(uploadItem.title, /Lluvia Nocturna/);
  const rights = JSON.parse(await readFile(path.join(item.root, uploadItem.rightsEvidence.file), "utf8"));
  assert.equal(rights.sourceProvenance.type, "owned_original_sleep_video");
});

test("fails a candidate closed when the complete ffmpeg decode fails", async () => {
  const item = await fixture();
  const result = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands({ decodeFails: true }) });
  assert.equal(result.packaged, 0);
  assert.equal(result.blocked[0].blocker, "full_media_decode_failed");
});

test("fully decodes every video and audio stream and blocks a corrupt secondary stream", async () => {
  const item = await fixture();
  let decodeCalled = false;
  const runCommand = async (command, args) => {
    if (command === "ffprobe") return { stdout: JSON.stringify({
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, pix_fmt: "yuv420p" },
        { codec_type: "video", codec_name: "mjpeg", width: 320, height: 180, pix_fmt: "yuvj420p" },
        { codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000" },
        { codec_type: "audio", codec_name: "aac", channels: 1, sample_rate: "48000" },
      ],
      format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "26" },
    }) };
    decodeCalled = true;
    const maps = args.flatMap((value, index) => value === "-map" ? [args[index + 1]] : []);
    assert.deepEqual(maps, ["0:v", "0:a"]);
    throw new Error("corrupt secondary audio stream");
  };
  const result = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: { runCommand } });
  assert.equal(decodeCalled, true);
  assert.equal(result.packaged, 0);
  assert.equal(result.blocked[0].blocker, "full_media_decode_failed");
});

test("rejects a rendered file whose hash no longer matches the completed report", async () => {
  const item = await fixture();
  await writeFile(path.join(item.root, item.report.motivation.es.results[0].outputFile), "tampered");
  const result = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() });
  assert.equal(result.packaged, 0);
  assert.equal(result.blocked[0].blocker, "media_hash_mismatch");
});

test("enforces five Shorts per channel and one sleep video per rolling week", async () => {
  const item = await fixture({ motivationCount: 6, includeSleep: true });
  await writeFile(path.join(item.root, "reports/youtube-upload-ledger.json"), JSON.stringify({ schemaVersion: 1, items: [
    { lane: "motivation_es", itemId: "old-short", status: "uploaded", recordedAt: NOW.toISOString() },
    { lane: "sleep", itemId: "old-sleep", status: "uncertain_outcome", recordedAt: new Date(NOW.getTime() - DAY()).toISOString() },
  ] }));
  const result = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() });
  assert.equal(result.items.filter((row) => row.lane === "motivation_es").length, 4);
  assert.ok(result.blocked.filter((row) => row.blocker === "daily_lane_upload_cap_reached").length >= 2);
  assert.ok(result.blocked.some((row) => row.blocker === "rolling_seven_day_sleep_upload_cap_reached"));
});

function DAY() { return 86_400_000; }

test("pins the reviewed queue to the exact completed report hash", async () => {
  const item = await fixture();
  const result = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() });
  const queue = JSON.parse(await readFile(path.join(item.root, result.queueFile), "utf8"));
  assert.equal(queue.sourceReport.file, item.sourceReport);
  assert.equal(queue.sourceReport.sha256, sha(await readFile(path.join(item.root, item.sourceReport))));
});

test("rerun preserves and deduplicates an exact pinned reviewed queue", async () => {
  const item = await fixture();
  const first = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() });
  const second = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() });
  assert.equal(first.packaged, 1);
  assert.equal(second.packaged, 0);
  assert.equal(second.deduplicated.length, 1);
  const queue = JSON.parse(await readFile(path.join(item.root, second.queueFile), "utf8"));
  assert.equal(queue.items.length, 1);
});

test("fails closed when a legacy or tampered reviewed queue lacks audience or privacy evidence", async () => {
  const audience = await fixture();
  const first = await packageYouTubeUploads({ configPath: audience.configPath, now: NOW, operations: fakeMediaCommands() });
  const audienceQueuePath = path.join(audience.root, first.queueFile);
  const audienceQueue = JSON.parse(await readFile(audienceQueuePath, "utf8"));
  const audienceItemPath = path.join(audience.root, audienceQueue.items[0].itemFile);
  const audienceItem = JSON.parse(await readFile(audienceItemPath, "utf8"));
  delete audienceItem.madeForKids;
  await writeFile(audienceItemPath, JSON.stringify(audienceItem));
  await assert.rejects(
    () => packageYouTubeUploads({ configPath: audience.configPath, now: NOW, operations: fakeMediaCommands() }),
    /existing_reviewed_queue_audience_invalid/,
  );

  const privacy = await fixture();
  const second = await packageYouTubeUploads({ configPath: privacy.configPath, now: NOW, operations: fakeMediaCommands() });
  const privacyQueuePath = path.join(privacy.root, second.queueFile);
  const privacyQueue = JSON.parse(await readFile(privacyQueuePath, "utf8"));
  delete privacyQueue.authorization.privacyPolicyAcceptance;
  await writeFile(privacyQueuePath, JSON.stringify(privacyQueue));
  await assert.rejects(
    () => packageYouTubeUploads({ configPath: privacy.configPath, now: NOW, operations: fakeMediaCommands() }),
    /existing_reviewed_queue_privacy_policy_acceptance_invalid/,
  );
});

test("rerun treats existing reviewed queue item files and hashes as active outcomes", async () => {
  const item = await fixture({ motivationCount: 2 });
  const firstRow = item.report.motivation.es.results[0];
  const secondRow = item.report.motivation.es.results[1];
  secondRow.outputFile = firstRow.outputFile;
  secondRow.outputSha256 = firstRow.outputSha256;
  const provenanceFile = path.join(item.root, "evidence/motivation", secondRow.shortId, "provenance.json");
  await writeFile(provenanceFile, JSON.stringify({ schemaVersion: 1, ...secondRow }));
  await writeFile(path.join(item.root, item.sourceReport), JSON.stringify(item.report));

  const first = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() });
  assert.equal(first.packaged, 1);
  assert.equal(first.blocked[0].blocker, "duplicate_or_uncertain_outcome");

  const second = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() });
  assert.equal(second.packaged, 0);
  assert.equal(second.deduplicated.length, 1);
  assert.equal(second.blocked[0].blocker, "duplicate_or_uncertain_outcome");
  const queue = JSON.parse(await readFile(path.join(item.root, second.queueFile), "utf8"));
  assert.equal(queue.items.length, 1);
});

test("requires the owner-reviewed config file to be mode 0600", async () => {
  const item = await fixture();
  await chmod(item.configPath, 0o644);
  await assert.rejects(() => packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() }), /config_must_be_owner_only_0600/);
});

test("requires an explicit boolean madeForKids choice for every channel", async () => {
  const missing = await fixture();
  delete missing.config.channels.motivation_en.madeForKids;
  await writeFile(missing.configPath, JSON.stringify(missing.config), { mode: 0o600 });
  await assert.rejects(
    () => packageYouTubeUploads({ configPath: missing.configPath, now: NOW, operations: fakeMediaCommands() }),
    /motivation_en_made_for_kids_choice_required/,
  );

  const nonBoolean = await fixture();
  nonBoolean.config.channels.sleep.madeForKids = "false";
  await writeFile(nonBoolean.configPath, JSON.stringify(nonBoolean.config), { mode: 0o600 });
  await assert.rejects(
    () => packageYouTubeUploads({ configPath: nonBoolean.configPath, now: NOW, operations: fakeMediaCommands() }),
    /sleep_made_for_kids_choice_required/,
  );
});

test("requires Robert's explicit acceptance of the pinned YouTube privacy policy version", async () => {
  const missing = await fixture();
  delete missing.config.authorization.privacyPolicyAccepted;
  await writeFile(missing.configPath, JSON.stringify(missing.config), { mode: 0o600 });
  await assert.rejects(
    () => packageYouTubeUploads({ configPath: missing.configPath, now: NOW, operations: fakeMediaCommands() }),
    /youtube_privacy_policy_acceptance_required/,
  );

  const stale = await fixture();
  stale.config.authorization.privacyPolicyVersion = "2026-08-25";
  await writeFile(stale.configPath, JSON.stringify(stale.config), { mode: 0o600 });
  await assert.rejects(
    () => packageYouTubeUploads({ configPath: stale.configPath, now: NOW, operations: fakeMediaCommands() }),
    /youtube_privacy_policy_acceptance_required/,
  );
});

test("copies each explicit madeForKids choice into the uploader item and reviewed queue", async () => {
  const item = await fixture({ motivationCount: 0, includeSleep: true });
  item.config.channels.sleep.madeForKids = true;
  await writeFile(item.configPath, JSON.stringify(item.config), { mode: 0o600 });
  const result = await packageYouTubeUploads({
    configPath: item.configPath,
    now: NOW,
    operations: fakeMediaCommands({ sleep: true }),
  });
  assert.equal(result.packaged, 1);
  const queue = JSON.parse(await readFile(path.join(item.root, result.queueFile), "utf8"));
  const uploadItem = JSON.parse(await readFile(path.join(item.root, queue.items[0].itemFile), "utf8"));
  assert.equal(queue.items[0].madeForKids, true);
  assert.equal(uploadItem.madeForKids, true);
});

test("public packaging requires separate explicit Robert authorization and writes it to item and queue", async () => {
  const missing = await fixture({ privacy: "public" });
  await assert.rejects(() => packageYouTubeUploads({ configPath: missing.configPath, now: NOW, operations: fakeMediaCommands() }), /explicit_public_authorization_required/);
  const publicAuthorization = { public: true, authorizedBy: "Robert", authorizedAt: "2026-08-24T15:30:00.000Z" };
  const approved = await fixture({ privacy: "public", publicAuth: publicAuthorization, auditVerified: true });
  const result = await packageYouTubeUploads({ configPath: approved.configPath, now: NOW, operations: fakeMediaCommands() });
  const queue = JSON.parse(await readFile(path.join(approved.root, result.queueFile), "utf8"));
  const uploadItem = JSON.parse(await readFile(path.join(approved.root, queue.items[0].itemFile), "utf8"));
  assert.deepEqual(queue.items[0].publicAuthorization, publicAuthorization);
  assert.deepEqual(uploadItem.publishAuthorization, publicAuthorization);
  assert.equal(result.uploadAttempted, false);
});

test("schedules five Shorts as private future uploads spaced in America/New_York across DST", async () => {
  const publicAuthorization = { public: true, authorizedBy: "Robert", authorizedAt: "2026-03-07T20:00:00.000Z" };
  const item = await fixture({ motivationCount: 5, publicAuth: publicAuthorization, auditVerified: true });
  item.config.scheduling = { timeZone: "America/New_York" };
  item.config.channels.motivation_es.schedule = {
    enabled: true, localTimes: ["08:00", "11:00", "14:00", "17:00", "20:00"],
  };
  await writeFile(item.configPath, JSON.stringify(item.config), { mode: 0o600 });
  const now = new Date("2026-03-08T04:00:00.000Z");
  const result = await packageYouTubeUploads({ configPath: item.configPath, now, operations: fakeMediaCommands() });
  assert.equal(result.packaged, 5);
  const publishTimes = result.items.map((row) => row.publishAt);
  assert.equal(publishTimes[0], "2026-03-08T12:00:00.000Z");
  assert.deepEqual(publishTimes.map((value) => new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value))), ["08:00", "11:00", "14:00", "17:00", "20:00"]);
  assert.ok(publishTimes.every((value, index) => index === 0 || Date.parse(value) - Date.parse(publishTimes[index - 1]) >= 2 * 60 * 60 * 1000));
  const queue = JSON.parse(await readFile(path.join(item.root, result.queueFile), "utf8"));
  for (const entry of queue.items) {
    const uploadItem = JSON.parse(await readFile(path.join(item.root, entry.itemFile), "utf8"));
    assert.equal(uploadItem.privacyStatus, "private");
    assert.equal(uploadItem.youtubeApiProjectAuditVerified, true);
    assert.deepEqual(entry.publicAuthorization, publicAuthorization);
  }
  assert.ok(result.items.every((row) => row.scheduled && row.publicConfirmed === false && row.publicUrl === null));
});

test("rejects schedules that could bulk-publish Shorts without spacing", async () => {
  const publicAuthorization = { public: true, authorizedBy: "Robert", authorizedAt: "2026-08-24T15:30:00.000Z" };
  const item = await fixture({ motivationCount: 5, publicAuth: publicAuthorization, auditVerified: true });
  item.config.scheduling = { timeZone: "America/New_York" };
  item.config.channels.motivation_es.schedule = { enabled: true, localTimes: ["08:00", "08:30", "09:00", "09:30", "10:00"] };
  await writeFile(item.configPath, JSON.stringify(item.config), { mode: 0o600 });
  await assert.rejects(() => packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() }), /schedule_spacing_too_short/);
});

test("allows target six only with an evidence-backed CEO learning recommendation", async () => {
  const publicAuthorization = { public: true, authorizedBy: "Robert", authorizedAt: "2026-08-24T15:30:00.000Z" };
  const item = await fixture({ motivationCount: 6, publicAuth: publicAuthorization, auditVerified: true });
  item.config.authorization.motivationShortsPerDayPerChannel = 6;
  item.config.scheduling = { timeZone: "America/New_York" };
  item.config.channels.motivation_es.schedule = {
    enabled: true, localTimes: ["07:00", "09:30", "12:00", "14:30", "17:00", "19:30"],
  };
  await writeFile(item.configPath, JSON.stringify(item.config), { mode: 0o600 });
  await assert.rejects(() => packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() }),
    /evidence_backed_learning_recommendation_required_above_five/);

  const evidenceFile = "reports/youtube-learning-recommendation.json";
  const evidence = { schemaVersion: 1, basedOnRealMetrics: true, recommendedTargetPerDay: 6,
    metrics: [{ name: "median_retention_percent", value: 71 }, { name: "views_per_short", value: 850 }] };
  await writeFile(path.join(item.root, evidenceFile), `${JSON.stringify(evidence)}\n`);
  item.config.scheduling.learningRecommendation = {
    approved: true, targetPerDay: 6, recommendedBy: "Clippers CEO", recommendedAt: "2026-08-24T15:45:00.000Z",
    evidence: { file: evidenceFile, sha256: sha(await readFile(path.join(item.root, evidenceFile))) },
  };
  await writeFile(item.configPath, JSON.stringify(item.config), { mode: 0o600 });
  const result = await packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() });
  assert.equal(result.items.filter((row) => row.lane === "motivation_es").length, 6);
  const queue = JSON.parse(await readFile(path.join(item.root, result.queueFile), "utf8"));
  assert.equal(queue.authorization.motivationShortsPerDayPerChannel, 6);
  assert.equal(queue.authorization.learningRecommendation.evidence.file, evidenceFile);
});

test("rejects a daily target above the safe ceiling of ten", async () => {
  const item = await fixture();
  item.config.authorization.motivationShortsPerDayPerChannel = 11;
  await writeFile(item.configPath, JSON.stringify(item.config), { mode: 0o600 });
  await assert.rejects(() => packageYouTubeUploads({ configPath: item.configPath, now: NOW, operations: fakeMediaCommands() }),
    /motivation_daily_target_must_be_between_one_and_ten/);
});
