import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { channelConfigFromEnv, runYouTubeUpload, sha256FileStream, validateUploadItem } from "../script/clippers-youtube-uploader.mjs";

const CHANNELS = {
  motivation_es: "UC1234567890123456789012",
  motivation_en: "UCabcdefghijklmnopqrstuv",
  sleep: "UCZYXWVUTSRQPONMLKJIHGFE",
};
const sha = (value) => createHash("sha256").update(value).digest("hex");
const PRIVACY_POLICY_ACCEPTANCE = Object.freeze({
  accepted: true, version: "2026-08-26", acceptedBy: "Robert", acceptedAt: "2026-08-26T05:00:00.000Z",
});

async function fixture(lane = "motivation_es", privacyStatus = "private") {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-youtube-uploader-"));
  const media = Buffer.from("pretend mp4 content");
  const itemId = `${lane}-001`;
  const mediaFile = `rendered/${itemId}.mp4`;
  const rightsFile = `rights/${itemId}.json`;
  const qaFile = `qa/${itemId}.json`;
  await Promise.all(["items", "rendered", "rights", "qa"].map((dir) => mkdir(path.join(root, dir), { recursive: true })));
  await writeFile(path.join(root, mediaFile), media);
  const rights = {
    schemaVersion: 1, assetType: "youtube_video", itemId, file: mediaFile, sha256: sha(media),
    rightsStatus: "owned", commercialUseAuthorized: true, verifiedBy: "Robert", verifiedAt: "2026-08-24T12:00:00.000Z",
  };
  const qa = {
    schemaVersion: 1, assetType: "youtube_video_qa", itemId, file: mediaFile, sha256: sha(media), approved: true,
    checks: { playbackComplete: true, videoValid: true, audioValid: true, formatAccepted: true },
    reviewedBy: "QA", reviewedAt: "2026-08-24T12:05:00.000Z",
  };
  const rightsBytes = Buffer.from(`${JSON.stringify(rights, null, 2)}\n`);
  const qaBytes = Buffer.from(`${JSON.stringify(qa, null, 2)}\n`);
  await writeFile(path.join(root, rightsFile), rightsBytes);
  await writeFile(path.join(root, qaFile), qaBytes);
  const item = {
    schemaVersion: 1, itemId, lane, file: mediaFile, sha256: sha(media), title: "Original motivation",
    description: "Original content by Clippers.", privacyStatus, madeForKids: false,
    privacyPolicyAcceptance: PRIVACY_POLICY_ACCEPTANCE,
    rightsEvidence: { file: rightsFile, sha256: sha(rightsBytes) },
    qaEvidence: { file: qaFile, sha256: sha(qaBytes) },
  };
  if (privacyStatus === "public") {
    item.publishAuthorization = { public: true, authorizedBy: "Robert", authorizedAt: "2026-08-24T12:10:00.000Z" };
    item.youtubeApiProjectAuditVerified = true;
  }
  const itemFile = `items/${itemId}.json`;
  await writeFile(path.join(root, itemFile), `${JSON.stringify(item, null, 2)}\n`);
  return { root, item, itemFile };
}

function configs() {
  return Object.fromEntries(Object.entries(CHANNELS).map(([lane, expectedChannelId]) => [lane, {
    lane, expectedChannelId, clientId: `${lane}-client`, clientSecret: `${lane}-secret`, refreshToken: `${lane}-refresh`,
  }]));
}

function successfulFetch(expectedChannelId, counters = {}) {
  return async (url, init = {}) => {
    counters.calls = (counters.calls || 0) + 1;
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "short-lived-token" });
    if (String(url).includes("channels?")) return Response.json({ items: [{ id: expectedChannelId }] });
    if (init.method === "POST") return new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=opaque" } });
    if (init.method === "PUT") return Response.json({ id: "video123", status: { privacyStatus: "public" } });
    throw new Error("unexpected request");
  };
}

test("defines three independent lane configs without exposing shared fallback credentials", () => {
  const env = {
    CLIPPERS_YOUTUBE_ES_CHANNEL_ID: CHANNELS.motivation_es,
    CLIPPERS_YOUTUBE_ES_CLIENT_ID: "es-client",
    CLIPPERS_YOUTUBE_ES_CLIENT_SECRET: "es-secret",
    CLIPPERS_YOUTUBE_ES_REFRESH_TOKEN: "es-refresh",
  };
  assert.equal(channelConfigFromEnv(env, "motivation_es").expectedChannelId, CHANNELS.motivation_es);
  assert.equal(channelConfigFromEnv(env, "motivation_en").clientId, "");
  assert.equal(channelConfigFromEnv(env, "sleep").refreshToken, "");
});

test("hashes large media incrementally with the same SHA-256 result", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-youtube-hash-"));
  const bytes = Buffer.alloc(3 * 1024 * 1024 + 17, 0x5a);
  const file = path.join(root, "large-video.mp4");
  await writeFile(file, bytes);
  assert.equal(await sha256FileStream(file), sha(bytes));
});

test("dry-run validates exact artifacts and reports missing auth without network", async () => {
  const { root, itemFile } = await fixture();
  let calls = 0;
  const result = await runYouTubeUpload({ workspaceRoot: root, itemFile, env: {}, dryRun: true, fetcher: async () => { calls += 1; } });
  assert.equal(result.status, "preflight");
  assert.ok(result.blockers.includes("expected_channel_id_missing_or_invalid"));
  assert.ok(result.blockers.includes("oauth_refresh_config_missing"));
  assert.equal(result.rightsVerified, true);
  assert.equal(result.qaApproved, true);
  assert.equal(result.uploadAttempted, false);
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(result).includes("refresh"), true);
});

test("non-dry run fails closed when OAuth configuration is missing", async () => {
  const { root, itemFile } = await fixture();
  const result = await runYouTubeUpload({ workspaceRoot: root, itemFile, env: {}, fetcher: async () => { throw new Error("must not call"); } });
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("oauth_refresh_config_missing"));
  assert.equal(result.uploadAttempted, false);
});

test("fails closed before network when audience or privacy acceptance is missing or malformed", async () => {
  const missingAudience = await fixture();
  delete missingAudience.item.madeForKids;
  await writeFile(path.join(missingAudience.root, missingAudience.itemFile), `${JSON.stringify(missingAudience.item)}\n`);
  let calls = 0;
  const audienceResult = await runYouTubeUpload({
    workspaceRoot: missingAudience.root,
    itemFile: missingAudience.itemFile,
    channelConfigs: configs(),
    fetcher: async () => { calls += 1; },
  });
  assert.ok(audienceResult.blockers.includes("made_for_kids_choice_required"));

  const malformedAudience = await fixture();
  malformedAudience.item.madeForKids = "false";
  await writeFile(path.join(malformedAudience.root, malformedAudience.itemFile), `${JSON.stringify(malformedAudience.item)}\n`);
  const malformedResult = await runYouTubeUpload({
    workspaceRoot: malformedAudience.root,
    itemFile: malformedAudience.itemFile,
    channelConfigs: configs(),
    fetcher: async () => { calls += 1; },
  });
  assert.ok(malformedResult.blockers.includes("made_for_kids_choice_required"));

  const stalePrivacy = await fixture();
  stalePrivacy.item.privacyPolicyAcceptance = { ...PRIVACY_POLICY_ACCEPTANCE, version: "2026-08-25" };
  await writeFile(path.join(stalePrivacy.root, stalePrivacy.itemFile), `${JSON.stringify(stalePrivacy.item)}\n`);
  const privacyResult = await runYouTubeUpload({
    workspaceRoot: stalePrivacy.root,
    itemFile: stalePrivacy.itemFile,
    channelConfigs: configs(),
    fetcher: async () => { calls += 1; },
  });
  assert.ok(privacyResult.blockers.includes("youtube_privacy_policy_acceptance_required"));
  assert.equal(calls, 0);
});

test("wrong authenticated channel blocks before creating a resumable session", async () => {
  const { root, itemFile } = await fixture("motivation_en");
  let calls = 0;
  const fetcher = async (url) => {
    calls += 1;
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "token" });
    return Response.json({ items: [{ id: CHANNELS.motivation_es }] });
  };
  const result = await runYouTubeUpload({ workspaceRoot: root, itemFile, env: {}, channelConfigs: configs(), fetcher });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["authenticated_channel_mismatch"]);
  assert.equal(calls, 2);
});

test("rejects a non-YouTube googleapis resumable location before media transfer", async () => {
  const { root, itemFile } = await fixture("motivation_es");
  let putCalls = 0;
  const fetcher = async (url, init = {}) => {
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "token" });
    if (String(url).includes("channels?")) return Response.json({ items: [{ id: CHANNELS.motivation_es }] });
    if (init.method === "POST") return new Response(null, {
      status: 200,
      headers: { location: "https://www.googleapis.com/upload/calendar/v3/events?uploadType=resumable&upload_id=opaque" },
    });
    if (init.method === "PUT") putCalls += 1;
    throw new Error("unexpected request");
  };
  const result = await runYouTubeUpload({ workspaceRoot: root, itemFile, env: {}, channelConfigs: configs(), fetcher });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["resumable_session_rejected"]);
  assert.equal(putCalls, 0);
});

test("successful private upload writes a dedupe ledger and a second run does no network work", async () => {
  const { root, itemFile } = await fixture("sleep");
  const counters = {};
  const first = await runYouTubeUpload({ workspaceRoot: root, itemFile, env: {}, channelConfigs: configs(), fetcher: successfulFetch(CHANNELS.sleep, counters) });
  assert.equal(first.status, "uploaded", JSON.stringify(first));
  assert.equal(first.privacyStatus, "private");
  assert.equal(first.youtubeVideoId, "video123");
  assert.equal(first.apiCostUsd, 0);
  assert.equal(counters.calls, 4);
  const ledger = JSON.parse(await readFile(path.join(root, "reports", "youtube-upload-ledger.json"), "utf8"));
  assert.deepEqual(ledger.items.map((row) => row.status), ["upload_started", "uploaded"]);
  assert.equal(JSON.stringify(ledger).includes("short-lived-token"), false);
  assert.equal(JSON.stringify(ledger).includes("sleep-secret"), false);
  const second = await runYouTubeUpload({ workspaceRoot: root, itemFile, env: {}, channelConfigs: configs(), fetcher: async () => { throw new Error("must not call"); } });
  assert.equal(second.status, "duplicate");
  assert.deepEqual(second.blockers, ["duplicate_item_id"]);
});

test("transport ambiguity is recorded and blocks retry until manual reconciliation", async () => {
  const { root, itemFile } = await fixture();
  const fetcher = async (url, init = {}) => {
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "token" });
    if (String(url).includes("channels?")) return Response.json({ items: [{ id: CHANNELS.motivation_es }] });
    if (init.method === "POST") return new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=opaque" } });
    throw new Error("socket disconnected after bytes were sent");
  };
  const first = await runYouTubeUpload({ workspaceRoot: root, itemFile, env: {}, channelConfigs: configs(), fetcher });
  assert.equal(first.status, "uncertain_outcome");
  assert.deepEqual(first.blockers, ["manual_youtube_reconciliation_required"]);
  const ledger = JSON.parse(await readFile(path.join(root, "reports", "youtube-upload-ledger.json"), "utf8"));
  assert.equal(ledger.items.at(-1).status, "uncertain_outcome");
  const retry = await runYouTubeUpload({ workspaceRoot: root, itemFile, env: {}, channelConfigs: configs(), fetcher: async () => { throw new Error("must not call"); } });
  assert.equal(retry.status, "duplicate");
});

test("public privacy requires both item and global authorization", async () => {
  const missingItem = (await fixture("motivation_es", "public"));
  delete missingItem.item.publishAuthorization;
  assert.ok(validateUploadItem(missingItem.item).includes("per_item_public_authorization_missing"));

  const { root, itemFile } = await fixture("motivation_es", "public");
  let calls = 0;
  const blocked = await runYouTubeUpload({ workspaceRoot: root, itemFile, env: {}, channelConfigs: configs(), fetcher: async () => { calls += 1; } });
  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.blockers.includes("global_public_publish_authorization_missing"));
  assert.equal(calls, 0);

  const allowed = await runYouTubeUpload({ workspaceRoot: root, itemFile, env: {
    CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED: "true", CLIPPERS_YOUTUBE_API_PROJECT_AUDIT_VERIFIED: "true",
  }, channelConfigs: configs(), fetcher: successfulFetch(CHANNELS.motivation_es) });
  assert.equal(allowed.status, "uploaded");
  assert.equal(allowed.privacyStatus, "public");
  assert.equal(allowed.publicConfirmed, true);
});

test("scheduled publication validates future RFC3339, authorization, and sends private publishAt metadata", async () => {
  const { root, itemFile, item } = await fixture();
  item.publishAt = "2026-11-01T13:00:00.000Z";
  item.publishAuthorization = { public: true, authorizedBy: "Robert", authorizedAt: "2026-10-31T12:00:00.000Z" };
  item.youtubeApiProjectAuditVerified = true;
  await writeFile(path.join(root, itemFile), `${JSON.stringify(item, null, 2)}\n`);
  let requestBody;
  const fetcher = async (url, init = {}) => {
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "token" });
    if (String(url).includes("channels?")) return Response.json({ items: [{ id: CHANNELS.motivation_es }] });
    if (init.method === "POST") {
      requestBody = JSON.parse(init.body);
      return new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=scheduled" } });
    }
    return Response.json({ id: "scheduled123", status: { privacyStatus: "private", publishAt: item.publishAt } });
  };
  const result = await runYouTubeUpload({
    workspaceRoot: root, itemFile, now: new Date("2026-11-01T04:00:00.000Z"), channelConfigs: configs(), fetcher,
    env: { CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED: "true", CLIPPERS_YOUTUBE_API_PROJECT_AUDIT_VERIFIED: "true" },
  });
  assert.equal(result.status, "scheduled");
  assert.deepEqual(requestBody.status, { privacyStatus: "private", publishAt: item.publishAt, selfDeclaredMadeForKids: false });
  assert.equal(result.youtubeUrl, null);
  assert.equal(result.publicConfirmed, false);
});

test("rejects past or malformed publishAt before authentication", async () => {
  const { root, itemFile, item } = await fixture();
  item.publishAt = "2026-08-24 19:00";
  item.publishAuthorization = { public: true, authorizedBy: "Robert", authorizedAt: "2026-08-24T12:00:00.000Z" };
  item.youtubeApiProjectAuditVerified = true;
  await writeFile(path.join(root, itemFile), `${JSON.stringify(item, null, 2)}\n`);
  let calls = 0;
  const now = new Date("2026-08-24T16:00:00.000Z");
  const malformed = await runYouTubeUpload({ workspaceRoot: root, itemFile, now, env: {}, fetcher: async () => { calls += 1; } });
  assert.ok(malformed.blockers.includes("publish_at_rfc3339_invalid"));
  item.publishAt = "2026-08-24T15:59:59.000Z";
  await writeFile(path.join(root, itemFile), `${JSON.stringify(item, null, 2)}\n`);
  const past = await runYouTubeUpload({ workspaceRoot: root, itemFile, now, env: {}, fetcher: async () => { calls += 1; } });
  assert.ok(past.blockers.includes("publish_at_must_be_future"));
  assert.equal(calls, 0);
});

test("hash and evidence mismatches fail before authentication", async () => {
  const { root, itemFile, item } = await fixture();
  item.sha256 = "0".repeat(64);
  await writeFile(path.join(root, itemFile), `${JSON.stringify(item, null, 2)}\n`);
  let calls = 0;
  const result = await runYouTubeUpload({ workspaceRoot: root, itemFile, env: {}, channelConfigs: configs(), fetcher: async () => { calls += 1; } });
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("media_hash_mismatch"));
  assert.equal(calls, 0);
});

test("a corrupt ledger fails closed instead of erasing dedupe evidence", async () => {
  const { root, itemFile } = await fixture();
  await mkdir(path.join(root, "reports"), { recursive: true });
  await writeFile(path.join(root, "reports", "youtube-upload-ledger.json"), "{not-json\n");
  let calls = 0;
  const result = await runYouTubeUpload({ workspaceRoot: root, itemFile, env: {}, channelConfigs: configs(), fetcher: async () => { calls += 1; } });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["youtube_upload_ledger_invalid"]);
  assert.equal(calls, 0);
  assert.equal(await readFile(path.join(root, "reports", "youtube-upload-ledger.json"), "utf8"), "{not-json\n");
});
