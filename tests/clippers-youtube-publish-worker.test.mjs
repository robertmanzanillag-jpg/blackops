import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runYouTubePublishWorker } from "../script/clippers-youtube-publish-worker.mjs";
import { runYouTubeUpload } from "../script/clippers-youtube-uploader.mjs";

const CHANNELS = {
  motivation_es: "UC1234567890123456789012",
  motivation_en: "UCabcdefghijklmnopqrstuv",
  sleep: "UCZYXWVUTSRQPONMLKJIHGFE",
};
const sha = (value) => createHash("sha256").update(value).digest("hex");
const PRIVACY_POLICY_ACCEPTANCE = Object.freeze({
  accepted: true, version: "2026-08-26", acceptedBy: "Robert", acceptedAt: "2026-08-26T05:00:00.000Z",
});

function envFor(...lanes) {
  const env = {};
  for (const lane of lanes) {
    const suffix = lane === "motivation_es" ? "ES" : lane === "motivation_en" ? "EN" : "SLEEP";
    env[`CLIPPERS_YOUTUBE_${suffix}_CHANNEL_ID`] = CHANNELS[lane];
    env[`CLIPPERS_YOUTUBE_${suffix}_CLIENT_ID`] = `client-${suffix}`;
    env[`CLIPPERS_YOUTUBE_${suffix}_CLIENT_SECRET`] = `secret-${suffix}`;
    env[`CLIPPERS_YOUTUBE_${suffix}_REFRESH_TOKEN`] = `refresh-${suffix}`;
  }
  return env;
}

async function setup(specs, { ledger = [], publicQueueAuth = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-youtube-publish-worker-"));
  await Promise.all(["reports/content-worker", "youtube/items", "media", "rights", "qa"].map((dir) => mkdir(path.join(root, dir), { recursive: true })));
  const report = {
    schemaVersion: 1,
    status: "completed",
    motivation: { es: { results: [] }, en: { results: [] } },
    sleep: { result: { status: "not_planned" } },
  };
  const entries = [];
  for (const spec of specs) {
    const itemId = spec.itemId;
    const mediaFile = `media/${itemId}.mp4`;
    const media = Buffer.from(`media-${itemId}`);
    const mediaHash = sha(media);
    await writeFile(path.join(root, mediaFile), media);
    const rightsFile = `rights/${itemId}.json`;
    const qaFile = `qa/${itemId}.json`;
    const rights = {
      schemaVersion: 1, assetType: "youtube_video", itemId, file: mediaFile, sha256: mediaHash,
      rightsStatus: "owned", commercialUseAuthorized: true, verifiedBy: "reviewer", verifiedAt: "2026-08-24T12:00:00.000Z",
    };
    const qa = {
      schemaVersion: 1, assetType: "youtube_video_qa", itemId, file: mediaFile, sha256: mediaHash,
      approved: true, checks: { playbackComplete: true, videoValid: true, audioValid: true, formatAccepted: true },
      reviewedBy: "qa", reviewedAt: "2026-08-24T12:00:00.000Z",
    };
    await writeFile(path.join(root, rightsFile), `${JSON.stringify(rights)}\n`);
    await writeFile(path.join(root, qaFile), `${JSON.stringify(qa)}\n`);
    const privacyStatus = spec.privacyStatus || "private";
    const item = {
      schemaVersion: 1, itemId, lane: spec.lane, channelId: spec.channelId || CHANNELS[spec.lane], file: mediaFile, sha256: mediaHash,
      title: `Title ${itemId}`, description: "Original content", privacyStatus,
      madeForKids: spec.madeForKids ?? false,
      privacyPolicyAcceptance: PRIVACY_POLICY_ACCEPTANCE,
      rightsEvidence: { file: rightsFile, sha256: await hashPath(root, rightsFile) },
      qaEvidence: { file: qaFile, sha256: await hashPath(root, qaFile) },
      ...(privacyStatus === "public" ? { publishAuthorization: { public: true, authorizedBy: "Robert", authorizedAt: "2026-08-24T13:00:00.000Z" } } : {}),
      ...(spec.publishAt ? {
        publishAt: spec.publishAt,
        publishAuthorization: { public: true, authorizedBy: "Robert", authorizedAt: "2026-08-24T13:00:00.000Z" },
        youtubeApiProjectAuditVerified: true,
      } : {}),
      ...(privacyStatus === "public" ? { youtubeApiProjectAuditVerified: true } : {}),
    };
    const itemFile = `youtube/items/${itemId}.json`;
    await writeFile(path.join(root, itemFile), `${JSON.stringify(item)}\n`);
    let source;
    if (spec.lane === "sleep") {
      report.sleep.result = { status: "generated", outputPath: path.join(root, mediaFile), manifestPath: `${path.join(root, mediaFile)}.rights.json` };
      source = { type: "sleep_long" };
    } else {
      const language = spec.lane === "motivation_es" ? "es" : "en";
      report.motivation[language].results.push({ status: "rendered", shortId: itemId, outputFile: mediaFile, outputSha256: mediaHash });
      source = { type: "motivation_short", language, shortId: itemId };
    }
    entries.push({
      itemFile, approved: true, approvedBy: "Robert", approvedAt: "2026-08-24T13:00:00.000Z", source,
      madeForKids: spec.madeForKids ?? false,
      privacyPolicyAcceptance: PRIVACY_POLICY_ACCEPTANCE,
      ...(privacyStatus === "public" && publicQueueAuth ? { publicAuthorization: { public: true, authorizedBy: "Robert", authorizedAt: "2026-08-24T13:00:00.000Z" } } : {}),
      ...(spec.publishAt && publicQueueAuth ? {
        publicAuthorization: { public: true, authorizedBy: "Robert", authorizedAt: "2026-08-24T13:00:00.000Z" },
        youtubeApiProjectAuditVerified: true,
      } : {}),
      ...(privacyStatus === "public" && publicQueueAuth ? { youtubeApiProjectAuditVerified: true } : {}),
    });
  }
  const reportFile = "reports/content-worker/clippers-content-local-worker-latest.json";
  await writeFile(path.join(root, reportFile), `${JSON.stringify(report)}\n`);
  const queue = {
    schemaVersion: 1, reviewed: true, reviewedBy: "Robert", reviewedAt: "2026-08-24T13:00:00.000Z",
    sourceReport: { file: reportFile, sha256: await hashPath(root, reportFile) },
    authorization: { motivationShortsPerDayPerChannel: 5, privacyPolicyAcceptance: PRIVACY_POLICY_ACCEPTANCE },
    items: entries,
  };
  const queueFile = "youtube/reviewed-upload-queue.json";
  await writeFile(path.join(root, queueFile), `${JSON.stringify(queue)}\n`);
  if (ledger.length) await writeFile(path.join(root, "reports/youtube-upload-ledger.json"), `${JSON.stringify({ schemaVersion: 1, items: ledger })}\n`);
  return { root, queueFile, entries };
}

async function hashPath(root, relative) {
  return sha(await readFile(path.join(root, relative)));
}

function uploadedResult(options, sequence) {
  const lane = options.itemFile.includes("-es") ? "motivation_es" : options.itemFile.includes("-en") ? "motivation_en" : "sleep";
  return {
    status: "uploaded", blockers: [], itemId: path.basename(options.itemFile, ".json"), lane,
    privacyStatus: "private", uploadAttempted: true, youtubeVideoId: `video${sequence}`,
    youtubeUrl: `https://www.youtube.com/watch?v=video${sequence}`, apiCostUsd: 0,
  };
}

test("uploads independent ES, EN, and sleep lanes and writes only real returned IDs", async () => {
  const fixture = await setup([
    { itemId: "short-es", lane: "motivation_es" },
    { itemId: "short-en", lane: "motivation_en" },
    { itemId: "long-sleep", lane: "sleep" },
  ]);
  const calls = [];
  const result = await runYouTubePublishWorker({
    workspaceRoot: fixture.root, queueFile: fixture.queueFile,
    env: envFor("motivation_es", "motivation_en", "sleep"),
    now: new Date("2026-08-24T15:00:00.000Z"),
    runUpload: async (options) => { calls.push(options); return uploadedResult(options, calls.length); },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.uploaded, 3);
  assert.equal(calls.length, 3);
  assert.deepEqual(result.items.map((item) => item.youtubeVideoId), ["video1", "video2", "video3"]);
  const reportText = await readFile(result.reportPath, "utf8");
  assert.doesNotMatch(reportText, /refresh-|secret-|client-/);
  assert.equal(result.apiCostUsd, 0);
});

test("accepts uploaded only with a confirmed valid ID and constructs the canonical URL", async () => {
  const canonical = await setup([{ itemId: "short-es", lane: "motivation_es" }]);
  const good = await runYouTubePublishWorker({
    workspaceRoot: canonical.root, queueFile: canonical.queueFile, env: envFor("motivation_es"),
    runUpload: async () => ({
      status: "uploaded", itemId: "short-es", lane: "motivation_es", uploadAttempted: true,
      youtubeVideoId: "valid_123", youtubeUrl: "https://attacker.example/fake", blockers: [],
    }),
  });
  assert.equal(good.items[0].status, "uploaded");
  assert.equal(good.items[0].youtubeUrl, null);

  const invalid = await setup([{ itemId: "short-es", lane: "motivation_es" }]);
  const bad = await runYouTubePublishWorker({
    workspaceRoot: invalid.root, queueFile: invalid.queueFile, env: envFor("motivation_es"),
    runUpload: async () => ({
      status: "uploaded", itemId: "short-es", lane: "motivation_es", uploadAttempted: false,
      youtubeVideoId: null, youtubeUrl: "https://attacker.example/fake", blockers: [],
    }),
  });
  assert.equal(bad.items[0].status, "uncertain_outcome");
  assert.equal(bad.items[0].youtubeVideoId, null);
  assert.equal(bad.items[0].youtubeUrl, null);
  assert.deepEqual(bad.items[0].blockers, ["uploader_result_invalid", "manual_youtube_reconciliation_required"]);
});

test("does not invoke uploader when exact rights or QA evidence is missing", async () => {
  const fixture = await setup([{ itemId: "short-es", lane: "motivation_es" }]);
  const itemPath = path.join(fixture.root, fixture.entries[0].itemFile);
  const item = JSON.parse(await readFile(itemPath, "utf8"));
  item.qaEvidence.file = "qa/missing.json";
  await writeFile(itemPath, `${JSON.stringify(item)}\n`);
  let calls = 0;
  const result = await runYouTubePublishWorker({
    workspaceRoot: fixture.root, queueFile: fixture.queueFile, env: envFor("motivation_es"),
    runUpload: async () => { calls += 1; return {}; },
  });
  assert.equal(calls, 0);
  assert.ok(result.blockers.includes("qa_evidence_missing_or_unsafe"));
});

test("direct invocation rejects missing or mismatched audience and privacy acceptance", async () => {
  const audience = await setup([{ itemId: "short-es", lane: "motivation_es" }]);
  const audienceQueuePath = path.join(audience.root, audience.queueFile);
  const audienceQueue = JSON.parse(await readFile(audienceQueuePath, "utf8"));
  audienceQueue.items[0].madeForKids = true;
  await writeFile(audienceQueuePath, `${JSON.stringify(audienceQueue)}\n`);
  let calls = 0;
  const audienceResult = await runYouTubePublishWorker({
    workspaceRoot: audience.root, queueFile: audience.queueFile, env: envFor("motivation_es"),
    runUpload: async () => { calls += 1; return {}; },
  });
  assert.ok(audienceResult.items[0].blockers.includes("queue_item_audience_mismatch"));

  const missingEntryAudience = await setup([{ itemId: "short-es", lane: "motivation_es" }]);
  const missingEntryQueuePath = path.join(missingEntryAudience.root, missingEntryAudience.queueFile);
  const missingEntryQueue = JSON.parse(await readFile(missingEntryQueuePath, "utf8"));
  delete missingEntryQueue.items[0].madeForKids;
  await writeFile(missingEntryQueuePath, `${JSON.stringify(missingEntryQueue)}\n`);
  const missingEntryResult = await runYouTubePublishWorker({
    workspaceRoot: missingEntryAudience.root, queueFile: missingEntryAudience.queueFile, env: envFor("motivation_es"),
    runUpload: async () => { calls += 1; return {}; },
  });
  assert.ok(missingEntryResult.items[0].blockers.includes("queue_item_audience_choice_required"));

  const itemPrivacy = await setup([{ itemId: "short-es", lane: "motivation_es" }]);
  const itemPath = path.join(itemPrivacy.root, itemPrivacy.entries[0].itemFile);
  const item = JSON.parse(await readFile(itemPath, "utf8"));
  delete item.privacyPolicyAcceptance;
  await writeFile(itemPath, `${JSON.stringify(item)}\n`);
  const itemResult = await runYouTubePublishWorker({
    workspaceRoot: itemPrivacy.root, queueFile: itemPrivacy.queueFile, env: envFor("motivation_es"),
    runUpload: async () => { calls += 1; return {}; },
  });
  assert.ok(itemResult.items[0].blockers.includes("youtube_privacy_policy_acceptance_required"));

  const missingEntryPrivacy = await setup([{ itemId: "short-es", lane: "motivation_es" }]);
  const missingPrivacyQueuePath = path.join(missingEntryPrivacy.root, missingEntryPrivacy.queueFile);
  const missingPrivacyQueue = JSON.parse(await readFile(missingPrivacyQueuePath, "utf8"));
  delete missingPrivacyQueue.items[0].privacyPolicyAcceptance;
  await writeFile(missingPrivacyQueuePath, `${JSON.stringify(missingPrivacyQueue)}\n`);
  const missingPrivacyResult = await runYouTubePublishWorker({
    workspaceRoot: missingEntryPrivacy.root, queueFile: missingEntryPrivacy.queueFile, env: envFor("motivation_es"),
    runUpload: async () => { calls += 1; return {}; },
  });
  assert.ok(missingPrivacyResult.items[0].blockers.includes("queue_item_privacy_policy_acceptance_required"));

  const missingQueuePrivacy = await setup([{ itemId: "short-es", lane: "motivation_es" }]);
  const missingQueuePath = path.join(missingQueuePrivacy.root, missingQueuePrivacy.queueFile);
  const missingQueue = JSON.parse(await readFile(missingQueuePath, "utf8"));
  delete missingQueue.authorization.privacyPolicyAcceptance;
  await writeFile(missingQueuePath, `${JSON.stringify(missingQueue)}\n`);
  const missingQueueResult = await runYouTubePublishWorker({
    workspaceRoot: missingQueuePrivacy.root, queueFile: missingQueuePrivacy.queueFile, env: envFor("motivation_es"),
    runUpload: async () => { calls += 1; return {}; },
  });
  assert.ok(missingQueueResult.blockers.includes("queue_privacy_policy_acceptance_required"));

  const queuePrivacy = await setup([{ itemId: "short-es", lane: "motivation_es" }]);
  const queuePath = path.join(queuePrivacy.root, queuePrivacy.queueFile);
  const queue = JSON.parse(await readFile(queuePath, "utf8"));
  queue.authorization.privacyPolicyAcceptance = { ...PRIVACY_POLICY_ACCEPTANCE, acceptedAt: "2026-08-26T06:00:00.000Z" };
  await writeFile(queuePath, `${JSON.stringify(queue)}\n`);
  const queueResult = await runYouTubePublishWorker({
    workspaceRoot: queuePrivacy.root, queueFile: queuePrivacy.queueFile, env: envFor("motivation_es"),
    runUpload: async () => { calls += 1; return {}; },
  });
  assert.ok(queueResult.items[0].blockers.includes("queue_item_privacy_policy_acceptance_mismatch"));
  assert.equal(calls, 0);
});

test("fails closed per lane when channel or OAuth configuration is absent", async () => {
  const fixture = await setup([
    { itemId: "short-es", lane: "motivation_es" },
    { itemId: "short-en", lane: "motivation_en" },
  ]);
  let calls = 0;
  const result = await runYouTubePublishWorker({
    workspaceRoot: fixture.root, queueFile: fixture.queueFile, env: envFor("motivation_es"),
    runUpload: async () => { calls += 1; return {}; },
  });
  assert.equal(calls, 1);
  assert.equal(result.items[0].lane, "motivation_es");
  assert.ok(result.items[1].blockers.includes("expected_channel_id_missing_or_invalid"));
  assert.ok(result.items[1].blockers.includes("oauth_refresh_config_missing"));
});

test("fails closed before upload when reviewed item channel differs from selected lane channel", async () => {
  const fixture = await setup([{ itemId: "wrong-channel", lane: "motivation_es" }]);
  const calls = [];
  const env = envFor("motivation_es");
  env.CLIPPERS_YOUTUBE_ES_CHANNEL_ID = "UCzzzzzzzzzzzzzzzzzzzzzz";
  const result = await runYouTubePublishWorker({
    workspaceRoot: fixture.root,
    queueFile: fixture.queueFile,
    env,
    runUpload: async () => { calls.push("upload"); return { status: "uploaded" }; },
  });
  assert.deepEqual(calls, []);
  assert.ok(result.items[0].blockers.includes("item_channel_does_not_match_selected_channel"));
});

test("enforces five per motivation lane independently and one sleep upload per rolling week", async () => {
  const current = "2026-08-24T14:00:00.000Z";
  const rows = [
    ...Array.from({ length: 5 }, (_, index) => ({ itemId: `old-es-${index}`, lane: "motivation_es", status: "uploaded", recordedAt: current, file: `old/es-${index}.mp4`, sha256: sha(`old-es-${index}`) })),
    ...Array.from({ length: 4 }, (_, index) => ({ itemId: `old-en-${index}`, lane: "motivation_en", status: "uploaded", recordedAt: current, file: `old/en-${index}.mp4`, sha256: sha(`old-en-${index}`) })),
    { itemId: "old-sleep", lane: "sleep", status: "uncertain_outcome", recordedAt: current, file: "old/sleep.mp4", sha256: sha("old-sleep") },
  ];
  const fixture = await setup([
    { itemId: "short-es", lane: "motivation_es" },
    { itemId: "short-en", lane: "motivation_en" },
    { itemId: "long-sleep", lane: "sleep" },
  ], { ledger: rows });
  const calls = [];
  const result = await runYouTubePublishWorker({
    workspaceRoot: fixture.root, queueFile: fixture.queueFile,
    env: envFor("motivation_es", "motivation_en", "sleep"), now: new Date("2026-08-24T15:00:00.000Z"),
    runUpload: async (options) => { calls.push(options.itemFile); return uploadedResult(options, calls.length); },
  });
  assert.deepEqual(calls, ["youtube/items/short-en.json"]);
  assert.ok(result.items[0].blockers.includes("daily_lane_upload_cap_reached"));
  assert.ok(result.items[2].blockers.includes("rolling_seven_day_sleep_upload_cap_reached"));
});

test("counts an uploader state history once and blocks duplicates inside one reviewed queue", async () => {
  const recordedAt = "2026-08-24T14:00:00.000Z";
  const stateHistory = Array.from({ length: 4 }, (_, index) => [
    { itemId: `old-es-${index}`, lane: "motivation_es", status: "upload_started", recordedAt, file: `old/es-${index}.mp4`, sha256: sha(`old-es-${index}`) },
    { itemId: `old-es-${index}`, lane: "motivation_es", status: "uploaded", recordedAt, file: `old/es-${index}.mp4`, sha256: sha(`old-es-${index}`) },
  ]).flat();
  const fixture = await setup([
    { itemId: "short-es", lane: "motivation_es" },
    { itemId: "another-es", lane: "motivation_es" },
  ], { ledger: stateHistory });
  const queuePath = path.join(fixture.root, fixture.queueFile);
  const queue = JSON.parse(await readFile(queuePath, "utf8"));
  queue.items[1] = { ...queue.items[0] };
  await writeFile(queuePath, `${JSON.stringify(queue)}\n`);
  const calls = [];
  const result = await runYouTubePublishWorker({
    workspaceRoot: fixture.root, queueFile: fixture.queueFile, env: envFor("motivation_es"),
    now: new Date("2026-08-24T15:00:00.000Z"),
    runUpload: async (options) => { calls.push(options); return uploadedResult(options, calls.length); },
  });
  assert.equal(calls.length, 1);
  assert.ok(result.items[1].blockers.includes("existing_or_uncertain_item_outcome"));
  assert.ok(!result.items[0].blockers.includes("daily_lane_upload_cap_reached"));
});

test("public upload requires global, item, and reviewed queue authorization", async () => {
  const noQueueAuth = await setup([{ itemId: "short-es", lane: "motivation_es", privacyStatus: "public" }]);
  let calls = 0;
  const first = await runYouTubePublishWorker({
    workspaceRoot: noQueueAuth.root, queueFile: noQueueAuth.queueFile,
    env: { ...envFor("motivation_es"), CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED: "true", CLIPPERS_YOUTUBE_API_PROJECT_AUDIT_VERIFIED: "true" },
    runUpload: async () => { calls += 1; return {}; },
  });
  assert.equal(calls, 0);
  assert.ok(first.blockers.includes("per_item_public_authorization_missing"));

  const authorized = await setup([{ itemId: "short-es", lane: "motivation_es", privacyStatus: "public" }], { publicQueueAuth: true });
  const second = await runYouTubePublishWorker({
    workspaceRoot: authorized.root, queueFile: authorized.queueFile, env: envFor("motivation_es"),
    runUpload: async () => { calls += 1; return {}; },
  });
  assert.ok(second.blockers.includes("global_public_publish_authorization_missing"));
  assert.equal(calls, 0);

  const third = await runYouTubePublishWorker({
    workspaceRoot: authorized.root, queueFile: authorized.queueFile,
    env: { ...envFor("motivation_es"), CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED: "true", CLIPPERS_YOUTUBE_API_PROJECT_AUDIT_VERIFIED: "true" },
    runUpload: async (options) => { calls += 1; return { ...uploadedResult(options, calls), privacyStatus: "public", publicConfirmed: true }; },
  });
  assert.equal(third.uploaded, 1);
  assert.equal(calls, 1);
});

test("scheduled uploads require all public-intent gates and report scheduled without a public URL", async () => {
  const publishAt = "2026-08-25T12:00:00.000Z";
  const missingQueueAuth = await setup([{ itemId: "short-es", lane: "motivation_es", publishAt }]);
  let calls = 0;
  const blocked = await runYouTubePublishWorker({
    workspaceRoot: missingQueueAuth.root, queueFile: missingQueueAuth.queueFile,
    env: { ...envFor("motivation_es"), CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED: "true", CLIPPERS_YOUTUBE_API_PROJECT_AUDIT_VERIFIED: "true" },
    now: new Date("2026-08-24T15:00:00.000Z"), runUpload: async () => { calls += 1; return {}; },
  });
  assert.equal(calls, 0);
  assert.ok(blocked.blockers.includes("per_item_public_authorization_missing"));

  const fixture = await setup([{ itemId: "short-es", lane: "motivation_es", publishAt }], { publicQueueAuth: true });
  const result = await runYouTubePublishWorker({
    workspaceRoot: fixture.root, queueFile: fixture.queueFile,
    env: { ...envFor("motivation_es"), CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED: "true", CLIPPERS_YOUTUBE_API_PROJECT_AUDIT_VERIFIED: "true" },
    now: new Date("2026-08-24T15:00:00.000Z"),
    runUpload: async () => ({ status: "scheduled", itemId: "short-es", lane: "motivation_es", uploadAttempted: true,
      youtubeVideoId: "scheduled123", privacyStatus: "private", publishAt, blockers: [] }),
  });
  assert.equal(result.scheduled, 1);
  assert.equal(result.uploaded, 0);
  assert.equal(result.publicConfirmed, 0);
  assert.equal(result.items[0].youtubeUrl, null);
  assert.equal(result.items[0].publishAt, publishAt);
});

test("blocks a sixth scheduled Short per lane/day and schedules are not bulk immediate", async () => {
  const specs = Array.from({ length: 6 }, (_, index) => ({
    itemId: `short-es-${index}`, lane: "motivation_es",
    publishAt: `2026-08-25T${String(10 + index * 2).padStart(2, "0")}:00:00.000Z`,
  }));
  const fixture = await setup(specs, { publicQueueAuth: true });
  const calls = [];
  const result = await runYouTubePublishWorker({
    workspaceRoot: fixture.root, queueFile: fixture.queueFile,
    env: { ...envFor("motivation_es"), CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED: "true", CLIPPERS_YOUTUBE_API_PROJECT_AUDIT_VERIFIED: "true" },
    now: new Date("2026-08-24T15:00:00.000Z"),
    runUpload: async (options) => {
      calls.push(options.itemFile);
      const index = calls.length - 1;
      return { status: "scheduled", itemId: specs[index].itemId, lane: "motivation_es", uploadAttempted: true,
        youtubeVideoId: `sched${index}id`, privacyStatus: "private", publishAt: specs[index].publishAt, blockers: [] };
    },
  });
  assert.equal(calls.length, 5);
  assert.equal(result.scheduled, 5);
  assert.ok(result.items[5].blockers.includes("daily_lane_upload_cap_reached"));
  assert.ok(result.items.slice(0, 5).every((item) => item.youtubeUrl === null && item.publicConfirmed === false));
});

test("blocks schedule times closer than two hours in the same lane", async () => {
  const fixture = await setup([
    { itemId: "short-es-a", lane: "motivation_es", publishAt: "2026-08-25T12:00:00.000Z" },
    { itemId: "short-es-b", lane: "motivation_es", publishAt: "2026-08-25T12:30:00.000Z" },
  ], { publicQueueAuth: true });
  const calls = [];
  const result = await runYouTubePublishWorker({
    workspaceRoot: fixture.root, queueFile: fixture.queueFile,
    env: { ...envFor("motivation_es"), CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED: "true", CLIPPERS_YOUTUBE_API_PROJECT_AUDIT_VERIFIED: "true" },
    now: new Date("2026-08-24T15:00:00.000Z"),
    runUpload: async (options) => { calls.push(options); return { status: "scheduled", itemId: "short-es-a", lane: "motivation_es",
      uploadAttempted: true, youtubeVideoId: "schedulea", privacyStatus: "private", publishAt: "2026-08-25T12:00:00.000Z", blockers: [] }; },
  });
  assert.equal(calls.length, 1);
  assert.ok(result.items[1].blockers.includes("scheduled_publish_spacing_too_short"));
});

test("existing and uncertain outcomes block automatic retry by item, file, or hash", async () => {
  const fixture = await setup([{ itemId: "short-es", lane: "motivation_es" }]);
  const item = JSON.parse(await readFile(path.join(fixture.root, fixture.entries[0].itemFile), "utf8"));
  await writeFile(path.join(fixture.root, "reports/youtube-upload-ledger.json"), `${JSON.stringify({
    schemaVersion: 1,
    items: [{ itemId: item.itemId, lane: item.lane, status: "uncertain_outcome", recordedAt: "2026-08-24T14:00:00.000Z", file: item.file, sha256: item.sha256 }],
  })}\n`);
  let calls = 0;
  const result = await runYouTubePublishWorker({
    workspaceRoot: fixture.root, queueFile: fixture.queueFile, env: envFor("motivation_es"),
    runUpload: async () => { calls += 1; return {}; },
  });
  assert.equal(calls, 0);
  assert.ok(result.blockers.includes("existing_or_uncertain_item_outcome"));
  assert.equal(result.apiCostUsd, 0);
});

test("pins queue to an exact completed content report hash", async () => {
  const fixture = await setup([{ itemId: "short-es", lane: "motivation_es" }]);
  const queuePath = path.join(fixture.root, fixture.queueFile);
  const queue = JSON.parse(await readFile(queuePath, "utf8"));
  queue.sourceReport.sha256 = "0".repeat(64);
  await writeFile(queuePath, `${JSON.stringify(queue)}\n`);
  let calls = 0;
  const result = await runYouTubePublishWorker({
    workspaceRoot: fixture.root, queueFile: fixture.queueFile, env: envFor("motivation_es"),
    runUpload: async () => { calls += 1; return {}; },
  });
  assert.equal(calls, 0);
  assert.deepEqual(result.blockers, ["source_report_hash_mismatch"]);
});

test("recovers an orphaned publish worker lock from a dead PID", async () => {
  const fixture = await setup([{ itemId: "short-es", lane: "motivation_es" }]);
  await writeFile(path.join(fixture.root, "reports/youtube-publish-worker.lock"), `${JSON.stringify({
    pid: 999999,
    acquiredAt: "2026-08-24T12:00:00.000Z",
  })}\n`);
  const calls = [];
  const result = await runYouTubePublishWorker({
    workspaceRoot: fixture.root,
    queueFile: fixture.queueFile,
    env: envFor("motivation_es"),
    now: new Date("2026-08-24T15:00:00.000Z"),
    runUpload: async (options) => { calls.push(options); return uploadedResult(options, calls.length); },
  });
  assert.equal(result.uploaded, 1);
  assert.equal(calls.length, 1);
});

test("recovers an old empty uploader ledger lock before a verified upload", async () => {
  const fixture = await setup([{ itemId: "short-es", lane: "motivation_es" }]);
  const lockPath = path.join(fixture.root, "reports/youtube-upload-ledger.json.lock");
  await writeFile(lockPath, "");
  const old = new Date(Date.now() - 31 * 60 * 1000);
  await utimes(lockPath, old, old);
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "access-token" });
    }
    if (String(url).includes("youtube/v3/channels")) {
      return Response.json({ items: [{ id: CHANNELS.motivation_es }] });
    }
    if (String(url).includes("upload/youtube/v3/videos") && !String(url).includes("upload_id=")) {
      return new Response("", {
        status: 200,
        headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=upload123" },
      });
    }
    return Response.json({ id: "video123" });
  };
  const result = await runYouTubeUpload({
    workspaceRoot: fixture.root,
    itemFile: fixture.entries[0].itemFile,
    env: envFor("motivation_es"),
    now: new Date("2026-08-24T15:00:00.000Z"),
    fetcher,
  });
  assert.equal(result.status, "uploaded");
  assert.equal(result.youtubeUrl, null);
  assert.equal(calls.length, 4);
  const ledger = JSON.parse(await readFile(path.join(fixture.root, "reports/youtube-upload-ledger.json"), "utf8"));
  assert.deepEqual(ledger.items.map((item) => item.status), ["upload_started", "uploaded"]);
});
