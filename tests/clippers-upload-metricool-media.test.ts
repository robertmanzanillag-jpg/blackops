import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildGoogleDrivePublicDownloadUrl } from "../server/google-drive";
import {
  runClipperMetricoolMediaUpload,
  verifyPublicMetricoolMediaUrl,
} from "../script/clippers-upload-metricool-media";
import { loadClipperSelectedEnv } from "../script/clippers-selected-env.mjs";

function createTestMp4(filePath: string) {
  const result = spawnSync("ffmpeg", [
    "-loglevel", "error",
    "-f", "lavfi",
    "-i", "color=c=blue:s=720x1280:d=1",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-y",
    filePath,
  ]);
  assert.equal(result.status, 0, result.stderr?.toString());
}

async function createEligibleCampaignWorkspace(root: string) {
  const draftFile = "drafts/vyro/test/clip-01.mp4";
  const evidencePath = "evidence-drop/vyro/test.md";
  await mkdir(path.join(root, "research"), { recursive: true });
  await mkdir(path.join(root, path.dirname(draftFile)), { recursive: true });
  await mkdir(path.join(root, path.dirname(evidencePath)), { recursive: true });
  createTestMp4(path.join(root, draftFile));
  const sourceUrl = "https://app.vyro.com/campaign/source";
  await writeFile(path.join(root, evidencePath), [
    "# Verified marketplace authorization",
    "Campaign id: verified-campaign",
    "Marketplace: vyro",
    `Source: ${sourceUrl}`,
    "The campaign explicitly authorizes this source and account for the documented clipping workflow.",
  ].join("\n"));
  await writeFile(path.join(root, "research", "paid-streamer-campaigns.json"), JSON.stringify([{
    id: "verified-campaign",
    title: "Verified campaign",
    creator: "Creator",
    creatorTier: "top",
    creatorReachEvidence: "https://www.youtube.com/@verifiedcreator",
    marketplace: "vyro",
    active: true,
    joined: true,
    expiresAt: "2027-07-29T18:00:00.000Z",
    payoutCpm: 1,
    minViewsPerPost: 1000,
    rightsEvidencePath: evidencePath,
    sourceUrl,
    accountHandle: "streamersclipusa",
    sourceFilesReady: 1,
    draftsReady: 1,
    requiredHashtags: ["#Creator"],
    draftFiles: [draftFile],
    draftMetadata: {
      "clip-01.mp4": {
        caption: "Verified clip #Creator",
        requiredHashtags: ["#Creator"],
        requiresTranscript: false,
      },
    },
  }], null, 2));
  await writeFile(path.join(root, "research", "paid-streamer-campaign-metrics.json"), "[]\n");
  return { draftFile };
}

test("builds a strict Google Drive public download URL", () => {
  assert.equal(
    buildGoogleDrivePublicDownloadUrl("1AbCdEfGhIjKlMnOp"),
    "https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download&confirm=t",
  );
  assert.throws(() => buildGoogleDrivePublicDownloadUrl("../bad"));
});

test("rejects a Google Drive HTML interstitial as public Metricool media", async () => {
  const accepted = await verifyPublicMetricoolMediaUrl("https://drive.example/video", async () => (
    new Response("<html>warning</html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  ) as Response);
  assert.equal(accepted, false);
});

test("accepts a ranged public MP4 response for Metricool", async () => {
  const accepted = await verifyPublicMetricoolMediaUrl("https://drive.example/video", async () => (
    new Response(new Uint8Array([0]), {
      status: 206,
      headers: { "content-type": "video/mp4" },
    })
  ) as Response);
  assert.equal(accepted, true);
});

test("selected env loader never imports unrelated AI credentials", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-selected-env-"));
  try {
    await writeFile(path.join(root, ".env.local"), [
      "METRICOOL_USER_ID=3558197",
      "GOOGLE_CLIENT_ID=drive-client",
      "OPENAI_API_KEY=must-not-load",
    ].join("\n"));
    const env: NodeJS.ProcessEnv = {};
    loadClipperSelectedEnv(root, env);
    assert.equal(env.METRICOOL_USER_ID, "3558197");
    assert.equal(env.GOOGLE_CLIENT_ID, "drive-client");
    assert.equal(env.OPENAI_API_KEY, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uploads only rights-verified MP4s and persists their public Metricool URL", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-drive-media-"));
  const draftFile = "drafts/vyro/test/clip-01.mp4";
  const evidencePath = "evidence-drop/vyro/test.md";
  try {
    await mkdir(path.join(root, "research"), { recursive: true });
    await mkdir(path.join(root, path.dirname(draftFile)), { recursive: true });
    await mkdir(path.join(root, path.dirname(evidencePath)), { recursive: true });
    createTestMp4(path.join(root, draftFile));
    const sourceUrl = "https://app.vyro.com/campaign/source";
    await writeFile(path.join(root, evidencePath), [
      "# Verified marketplace authorization",
      "Campaign id: verified-campaign",
      "Marketplace: vyro",
      `Source: ${sourceUrl}`,
      "The campaign explicitly authorizes this source and account for the documented clipping workflow.",
    ].join("\n"));
    await writeFile(path.join(root, "research", "paid-streamer-campaigns.json"), JSON.stringify([{
      id: "verified-campaign",
      title: "Verified campaign",
      creator: "Creator",
      creatorTier: "top",
      creatorReachEvidence: "https://www.youtube.com/@verifiedcreator",
      marketplace: "vyro",
      active: true,
      joined: true,
      expiresAt: "2027-07-29T18:00:00.000Z",
      payoutCpm: 1,
      minViewsPerPost: 1000,
      rightsEvidencePath: evidencePath,
      sourceUrl,
      accountHandle: "streamersclipusa",
      sourceFilesReady: 1,
      draftsReady: 1,
      requiredHashtags: ["#Creator"],
      draftFiles: [draftFile],
      draftMetadata: {
        "clip-01.mp4": {
          caption: "Verified clip #Creator",
          requiredHashtags: ["#Creator"],
          requiresTranscript: false,
        },
      },
    }], null, 2));
    await writeFile(path.join(root, "research", "paid-streamer-campaign-metrics.json"), "[]\n");
    let uploadCalls = 0;
    const result = await runClipperMetricoolMediaUpload({
      workspaceRoot: root,
      env: {
        CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED: "true",
        CLIPPERS_PUBLIC_MEDIA_PROVIDER: "google_drive",
        CLIPPERS_METRICOOL_BLOG_ID: "6431687",
      },
      dependencies: {
        async ensureFolder(campaignId) {
          assert.equal(campaignId, "verified-campaign");
          return "drive-folder";
        },
        async uploadFile() {
          uploadCalls += 1;
          return { fileId: "1AbCdEfGhIjKlMnOp" };
        },
        async makePublic(fileId) {
          return buildGoogleDrivePublicDownloadUrl(fileId);
        },
        async verifyPublicUrl() {
          return true;
        },
      },
    });
    assert.equal(result.status, "completed");
    assert.equal(result.uploaded, 1);
    assert.equal(uploadCalls, 1);
    const campaigns = JSON.parse(await readFile(path.join(root, "research", "paid-streamer-campaigns.json"), "utf8"));
    assert.equal(campaigns[0].metricoolBlogId, 6431687);
    assert.match(campaigns[0].publicMediaUrls[draftFile], /^https:\/\/drive\.usercontent\.google\.com\//);
    assert.equal(campaigns[0].publicMediaUrls["clip-01.mp4"], campaigns[0].publicMediaUrls[draftFile]);

    await writeFile(path.join(root, "reports", "metricool-autopilot-ledger.json"), JSON.stringify([{
      draftFile,
      status: "scheduled",
      metricoolId: "metricool-123",
    }], null, 2));
    const skipped = await runClipperMetricoolMediaUpload({
      workspaceRoot: root,
      env: {
        CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED: "true",
        CLIPPERS_PUBLIC_MEDIA_PROVIDER: "google_drive",
        CLIPPERS_METRICOOL_BLOG_ID: "6431687",
      },
      dependencies: {
        async ensureFolder() {
          return "drive-folder";
        },
        async uploadFile() {
          throw new Error("A scheduled draft must not be uploaded again");
        },
        async makePublic() {
          throw new Error("A scheduled draft must not change Drive permissions again");
        },
        async verifyPublicUrl() {
          throw new Error("A scheduled draft must not be revalidated for upload");
        },
      },
    });
    assert.equal(skipped.skippedDelivered, 1);
    assert.equal(skipped.uploaded, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not upload media without explicit authorization", async () => {
  const result = await runClipperMetricoolMediaUpload({
    env: {},
    dependencies: {
      async ensureFolder() {
        throw new Error("must not run");
      },
      async uploadFile() {
        throw new Error("must not run");
      },
      async makePublic() {
        throw new Error("must not run");
      },
      async verifyPublicUrl() {
        throw new Error("must not run");
      },
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.uploaded, 0);
});

test("persists a provisional receipt and reuses the same Drive file after publication fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-drive-retry-"));
  try {
    const { draftFile } = await createEligibleCampaignWorkspace(root);
    let uploadCalls = 0;
    let publicationCalls = 0;
    const dependencies = {
      async ensureFolder() { return "drive-folder"; },
      async uploadFile() {
        uploadCalls += 1;
        return { fileId: "1AbCdEfGhIjKlMnOp" };
      },
      async makePublic(fileId: string) {
        assert.equal(fileId, "1AbCdEfGhIjKlMnOp");
        publicationCalls += 1;
        if (publicationCalls === 1) throw new Error("temporary Drive permission failure");
        return buildGoogleDrivePublicDownloadUrl(fileId);
      },
      async verifyPublicUrl() { return true; },
    };
    const first = await runClipperMetricoolMediaUpload({
      workspaceRoot: root,
      env: {
        CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED: "true",
        CLIPPERS_PUBLIC_MEDIA_PROVIDER: "google_drive",
        CLIPPERS_METRICOOL_BLOG_ID: "6431687",
      },
      dependencies,
    });
    assert.equal(first.status, "blocked");
    const pending = JSON.parse(await readFile(path.join(root, "reports", "metricool-public-media-receipts.json"), "utf8"));
    assert.equal(pending[0].status, "upload_pending_publication");
    assert.equal(pending[0].fileId, "1AbCdEfGhIjKlMnOp");

    const retry = await runClipperMetricoolMediaUpload({
      workspaceRoot: root,
      env: {
        CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED: "true",
        CLIPPERS_PUBLIC_MEDIA_PROVIDER: "google_drive",
        CLIPPERS_METRICOOL_BLOG_ID: "6431687",
      },
      dependencies,
    });
    assert.equal(retry.status, "completed");
    assert.equal(uploadCalls, 1, "retry must reuse the provisional Drive file");
    assert.equal(publicationCalls, 2);
    const ready = JSON.parse(await readFile(path.join(root, "reports", "metricool-public-media-receipts.json"), "utf8"));
    assert.equal(ready[0].status, "ready");
    assert.equal(ready[0].draftFile, draftFile);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dry-run validates eligible media without Drive mutations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-drive-dry-run-"));
  try {
    await createEligibleCampaignWorkspace(root);
    const result = await runClipperMetricoolMediaUpload({
      dryRun: true,
      workspaceRoot: root,
      env: {
        CLIPPERS_PUBLIC_MEDIA_PROVIDER: "google_drive",
        CLIPPERS_METRICOOL_BLOG_ID: "6431687",
      },
      dependencies: {
        async ensureFolder() { throw new Error("dry-run must not create folders"); },
        async uploadFile() { throw new Error("dry-run must not upload"); },
        async makePublic() { throw new Error("dry-run must not change permissions"); },
        async verifyPublicUrl() { throw new Error("dry-run must not fetch media"); },
      },
    });
    assert.equal(result.status, "dry_run");
    assert.equal(result.uploaded, 0);
    assert.equal(result.wouldUpload, 1);
    await assert.rejects(readFile(path.join(root, "reports", "metricool-public-media-receipts.json")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
