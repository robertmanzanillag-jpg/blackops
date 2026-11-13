import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { renderCampaignDrafts } from "../script/clippers-render-campaign-drafts.mjs";

const execFileAsync = promisify(execFile);
const now = new Date("2026-08-12T11:00:00.000Z");

async function makeWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-renderer-"));
  for (const directory of [
    "research/campaign-cut-manifests",
    "reports",
    "evidence-drop/marketplaces",
    "source-drop/approved",
  ]) await mkdir(path.join(root, directory), { recursive: true });
  return root;
}

async function makeSource(root, filename = "source.mp4", withAudio = true) {
  const target = path.join(root, "source-drop", "approved", filename);
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=12",
  ];
  if (withAudio) args.push("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=12");
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  if (withAudio) args.push("-c:a", "aac", "-shortest");
  args.push(target);
  await execFileAsync("ffmpeg", args);
  return path.relative(root, target);
}

function campaign(id, overrides = {}) {
  const sourceUrl = `https://market.example/${id}/source`;
  return {
    id,
    title: id,
    marketplace: "whop",
    active: true,
    joined: true,
    observedAt: "2026-08-12T10:00:00.000Z",
    expiresAt: "2026-08-14T10:00:00.000Z",
    rightsExpiresAt: "2026-08-14T10:00:00.000Z",
    sourceUrl,
    accountHandle: "streamersclipusa",
    evidenceVerified: true,
    rightsEvidencePath: `evidence-drop/marketplaces/${id}.md`,
    draftFiles: [],
    ...overrides,
  };
}

async function writeCampaign(root, row) {
  await writeFile(path.join(root, row.rightsEvidencePath), [
    `Campaign ${row.id}`,
    `Marketplace ${row.marketplace}`,
    `Authorized source ${row.sourceUrl}`,
    "Commercial authorization grants transformation and publishing rights for this active campaign.",
  ].join("\n"));
}

async function setupCatalog(root, rows) {
  for (const row of rows) await writeCampaign(root, row);
  await writeFile(path.join(root, "research", "paid-streamer-campaigns.json"), `${JSON.stringify(rows, null, 2)}\n`);
  await writeFile(path.join(root, "reports", "metricool-autopilot-ledger.json"), "[]\n");
  await writeFile(path.join(root, "reports", "metricool-public-media-receipts.json"), "[]\n");
}

async function writeManifest(root, campaignId, sourceFile, cuts) {
  const value = { schemaVersion: 1, campaignId, accountHandle: "streamersclipusa", cuts: cuts.map((cut) => ({ sourceFile, ...cut })) };
  await writeFile(path.join(root, "research", "campaign-cut-manifests", `${campaignId}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

test("renders a deterministic local 9:16 draft with audio, subtitles, hashes, and three evidence frames", { timeout: 60_000 }, async () => {
  const root = await makeWorkspace();
  try {
    const row = campaign("campaign-a");
    await setupCatalog(root, [row]);
    const sourceFile = await makeSource(root);
    await writeFile(path.join(root, "source-drop", "approved", "caption.srt"), "1\n00:00:00,000 --> 00:00:02,000\nLOCAL CAPTION\n");
    await writeManifest(root, row.id, sourceFile, [{
      id: "cut-01",
      startSeconds: 1,
      durationSeconds: 6,
      subtitleFile: "source-drop/approved/caption.srt",
    }]);

    const report = await renderCampaignDrafts({ workspaceRoot: root, now, targetDailyClips: 1 });
    assert.equal(report.status, "ready", JSON.stringify(report.blockers));
    assert.equal(report.summary.rendered, 1);
    const rendered = report.rendered[0];
    assert.deepEqual([rendered.probe.width, rendered.probe.height], [1080, 1920]);
    assert.ok(rendered.probe.audioCodec);
    assert.equal(rendered.subtitlesApplied, true);
    assert.match(rendered.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(rendered.outputSha256, /^[a-f0-9]{64}$/);
    assert.match(rendered.cutFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(rendered.evidenceFrames.length, 3);
    for (const frame of rendered.evidenceFrames) assert.match(frame.sha256, /^[a-f0-9]{64}$/);
    const catalog = JSON.parse(await readFile(path.join(root, "research", "paid-streamer-campaigns.json"), "utf8"));
    assert.deepEqual(catalog[0].draftFiles, [rendered.draftFile]);
    assert.equal(catalog[0].draftsReady, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("caps the daily target at five and selects at most two cuts from each campaign", { timeout: 120_000 }, async () => {
  const root = await makeWorkspace();
  try {
    const rows = [campaign("campaign-a"), campaign("campaign-b"), campaign("campaign-c")];
    await setupCatalog(root, rows);
    const sourceFile = await makeSource(root);
    for (const row of rows) await writeManifest(root, row.id, sourceFile, [
      { id: "cut-01", startSeconds: 0, durationSeconds: 5 },
      { id: "cut-02", startSeconds: 5, durationSeconds: 5 },
      { id: "cut-03", startSeconds: 1, durationSeconds: 5 },
    ]);
    const report = await renderCampaignDrafts({ workspaceRoot: root, now, targetDailyClips: 50 });
    assert.equal(report.targetDailyClips, 5);
    assert.equal(report.summary.rendered, 5);
    const counts = Object.groupBy(report.rendered, (row) => row.campaignId);
    assert.ok(Object.values(counts).every((items) => items.length <= 2));
    assert.ok(report.blockers.some((row) => row.reason === "daily_campaign_diversity_limit"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps output paths distinct when authorized campaign ids sanitize to the same readable name", { timeout: 60_000 }, async () => {
  const root = await makeWorkspace();
  try {
    const rows = [campaign("campaign+a"), campaign("campaign a")];
    await setupCatalog(root, rows);
    const sourceFile = await makeSource(root);
    await writeManifest(root, rows[0].id, sourceFile, [{ id: "cut", startSeconds: 0, durationSeconds: 5 }]);
    await writeManifest(root, rows[1].id, sourceFile, [{ id: "cut", startSeconds: 5, durationSeconds: 5 }]);
    const report = await renderCampaignDrafts({ workspaceRoot: root, now, targetDailyClips: 2 });
    assert.equal(report.summary.rendered, 2);
    assert.equal(new Set(report.rendered.map((row) => row.draftFile)).size, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed for stale campaigns, unsafe sources, missing audio, and previously delivered source ranges", { timeout: 60_000 }, async () => {
  const root = await makeWorkspace();
  try {
    const stale = campaign("stale", { observedAt: "2026-08-01T10:00:00.000Z" });
    const noAudio = campaign("no-audio");
    const duplicate = campaign("duplicate");
    await setupCatalog(root, [stale, noAudio, duplicate]);
    const silentSource = await makeSource(root, "silent.mp4", false);
    const validSource = await makeSource(root, "valid.mp4", true);
    await writeManifest(root, stale.id, validSource, [{ id: "cut-01", startSeconds: 0, durationSeconds: 5 }]);
    await writeManifest(root, noAudio.id, silentSource, [{ id: "cut-01", startSeconds: 0, durationSeconds: 5 }]);
    await writeManifest(root, duplicate.id, validSource, [{ id: "cut-01", startSeconds: 0, durationSeconds: 5 }]);
    const first = await renderCampaignDrafts({ workspaceRoot: root, now, targetDailyClips: 1, updateCampaignCatalog: false });
    assert.equal(first.summary.rendered, 1);
    const second = await renderCampaignDrafts({ workspaceRoot: root, now, targetDailyClips: 1, updateCampaignCatalog: false });
    assert.equal(second.status, "blocked");
    assert.equal(second.summary.rendered, 0);
    assert.ok(second.blockers.some((row) => row.reason === "campaign_not_current_or_authorized"));
    assert.ok(second.blockers.some((row) => row.reason === "source_audio_missing"));
    assert.ok(second.blockers.some((row) => row.reason === "duplicate_source_range_or_draft"));

    const third = await renderCampaignDrafts({ workspaceRoot: root, now, targetDailyClips: 1, updateCampaignCatalog: false });
    assert.equal(third.summary.rendered, 0);
    assert.ok(third.blockers.some((row) => row.reason === "duplicate_source_range_or_draft"));

    await writeManifest(root, "duplicate", "../outside.mp4", [{ id: "escape", startSeconds: 0, durationSeconds: 5 }]);
    const unsafe = await renderCampaignDrafts({ workspaceRoot: root, now, targetDailyClips: 1, updateCampaignCatalog: false });
    assert.ok(unsafe.blockers.some((row) => row.reason === "source_file_missing_or_unsafe"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
