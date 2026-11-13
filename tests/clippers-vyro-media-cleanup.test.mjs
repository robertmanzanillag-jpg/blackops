import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { cleanupPublishedVyroMedia } from "../script/clippers-cleanup-published-vyro-media.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-vyro-cleanup-"));
  const sourceDir = path.join(root, "source-drop", "streamers");
  const draftDir = path.join(root, "drafts", "vyro", "campaign");
  const evidenceDir = path.join(root, "evidence-drop", "publication");
  await mkdir(sourceDir, { recursive: true });
  await mkdir(draftDir, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  const sourceName = "mrbeast-jre-vyro-01.mp4";
  const draftPath = path.join(draftDir, "streamersclipusa-mrbeast-jre-01.mp4");
  const hookPath = path.join(draftDir, "mrbeast-jre-vyro-01-hook.png");
  await writeFile(path.join(sourceDir, sourceName), "source-media");
  await writeFile(draftPath, "draft-media");
  await writeFile(hookPath, "hook-image");
  const manifestPath = path.join(draftDir, "draft-manifest.json");
  const receiptsPath = path.join(draftDir, "publication-receipts.json");
  await writeFile(manifestPath, JSON.stringify({ account: "streamersclipusa", campaignId: "mrbeast-x-joe-rogan-test", clips: [{ sourceName, targetPath: draftPath }] }));
  const metricoolProofPath = path.join(evidenceDir, "metricool.md");
  const vyroSubmissionProofPath = path.join(evidenceDir, "vyro.md");
  const publishedPostUrl = "https://www.tiktok.com/@streamersclipusa/video/1234567890123456789";
  await writeFile(metricoolProofPath, `Metricool published proof for the verified campaign post. Public URL: ${publishedPostUrl}. Captured after the planner reported published.`);
  await writeFile(vyroSubmissionProofPath, `Vyro submission proof for campaign mrbeast-x-joe-rogan-test. Public URL: ${publishedPostUrl}. Submission confirmation was observed.`);
  return { root, sourceName, sourceDir, draftPath, hookPath, manifestPath, receiptsPath, metricoolProofPath, vyroSubmissionProofPath, publishedPostUrl };
}

test("retains media until TikTok, Metricool, and Vyro proofs are all present", async () => {
  const item = await fixture();
  await writeFile(item.receiptsPath, JSON.stringify([{
    sourceName: item.sourceName,
    publishedPostUrl: item.publishedPostUrl,
    publishedAt: "2026-07-21T18:00:00.000Z",
    metricoolStatus: "published",
    vyroSubmissionStatus: "pending",
    metricoolProofPath: item.metricoolProofPath,
    vyroSubmissionProofPath: item.vyroSubmissionProofPath,
  }]));
  const result = await cleanupPublishedVyroMedia({ workspaceRoot: item.root, manifestPath: item.manifestPath, receiptsPath: item.receiptsPath, execute: true });
  assert.equal(result.retained, 1);
  assert.ok((await stat(item.draftPath)).isFile());
});

test("deletes heavy media and keeps an evidence ledger after verified publication", async () => {
  const item = await fixture();
  await writeFile(item.receiptsPath, JSON.stringify([{
    sourceName: item.sourceName,
    publishedPostUrl: item.publishedPostUrl,
    publishedAt: "2026-07-21T18:00:00.000Z",
    metricoolStatus: "published",
    vyroSubmissionStatus: "submitted",
    metricoolProofPath: item.metricoolProofPath,
    vyroSubmissionProofPath: item.vyroSubmissionProofPath,
  }]));
  const result = await cleanupPublishedVyroMedia({ workspaceRoot: item.root, manifestPath: item.manifestPath, receiptsPath: item.receiptsPath, execute: true });
  assert.equal(result.deletedFiles, 3);
  await assert.rejects(stat(item.draftPath));
  const ledger = await readFile(result.ledgerPath, "utf8");
  assert.match(ledger, /1234567890123456789/);
  assert.match(ledger, /sha|[a-f0-9]{64}/i);
});

test("dry run never deletes eligible media", async () => {
  const item = await fixture();
  await writeFile(item.receiptsPath, JSON.stringify([{
    sourceName: item.sourceName,
    publishedPostUrl: item.publishedPostUrl,
    publishedAt: "2026-07-21T18:00:00.000Z",
    metricoolStatus: "published",
    vyroSubmissionStatus: "submitted",
    metricoolProofPath: item.metricoolProofPath,
    vyroSubmissionProofPath: item.vyroSubmissionProofPath,
  }]));
  const result = await cleanupPublishedVyroMedia({ workspaceRoot: item.root, manifestPath: item.manifestPath, receiptsPath: item.receiptsPath });
  assert.equal(result.status, "cleanup_dry_run");
  assert.ok((await stat(item.draftPath)).isFile());
});

test("status strings alone cannot authorize deletion without local proof files", async () => {
  const item = await fixture();
  await writeFile(item.receiptsPath, JSON.stringify([{
    sourceName: item.sourceName,
    publishedPostUrl: item.publishedPostUrl,
    publishedAt: "2026-07-21T18:00:00.000Z",
    metricoolStatus: "published",
    vyroSubmissionStatus: "submitted",
    metricoolProofPath: path.join(item.root, "missing-metricool-proof.md"),
    vyroSubmissionProofPath: path.join(item.root, "missing-vyro-proof.md"),
  }]));
  const result = await cleanupPublishedVyroMedia({ workspaceRoot: item.root, manifestPath: item.manifestPath, receiptsPath: item.receiptsPath, execute: true });
  assert.equal(result.retained, 1);
  assert.deepEqual(result.rows[0].blockers, ["metricool_local_proof_missing", "vyro_local_proof_missing"]);
  assert.ok((await stat(item.draftPath)).isFile());
});

test("rejects symlinked proof files", async () => {
  const item = await fixture();
  const externalProof = path.join(await mkdtemp(path.join(os.tmpdir(), "external-proof-")), "metricool.md");
  await writeFile(externalProof, `Metricool published proof outside the evidence vault. Public URL: ${item.publishedPostUrl}. This must not authorize cleanup.`);
  const linkedProof = path.join(item.root, "evidence-drop", "publication", "linked-metricool.md");
  await symlink(externalProof, linkedProof);
  await writeFile(item.receiptsPath, JSON.stringify([{
    sourceName: item.sourceName,
    publishedPostUrl: item.publishedPostUrl,
    publishedAt: "2026-07-21T18:00:00.000Z",
    metricoolStatus: "published",
    vyroSubmissionStatus: "submitted",
    metricoolProofPath: linkedProof,
    vyroSubmissionProofPath: item.vyroSubmissionProofPath,
  }]));
  const result = await cleanupPublishedVyroMedia({ workspaceRoot: item.root, manifestPath: item.manifestPath, receiptsPath: item.receiptsPath, execute: true });
  assert.equal(result.retained, 1);
  assert.ok(result.rows[0].blockers.includes("metricool_local_proof_missing"));
  assert.ok((await stat(item.draftPath)).isFile());
});

test("duplicate source names cannot share one receipt to authorize cleanup", async () => {
  const item = await fixture();
  await writeFile(item.manifestPath, JSON.stringify({
    account: "streamersclipusa",
    campaignId: "mrbeast-x-joe-rogan-test",
    clips: [
      { sourceName: item.sourceName, targetPath: item.draftPath },
      { sourceName: item.sourceName, targetPath: item.draftPath },
    ],
  }));
  await writeFile(item.receiptsPath, JSON.stringify([{
    sourceName: item.sourceName,
    publishedPostUrl: item.publishedPostUrl,
    publishedAt: "2026-07-21T18:00:00.000Z",
    metricoolStatus: "published",
    vyroSubmissionStatus: "submitted",
    metricoolProofPath: item.metricoolProofPath,
    vyroSubmissionProofPath: item.vyroSubmissionProofPath,
  }]));
  const result = await cleanupPublishedVyroMedia({ workspaceRoot: item.root, manifestPath: item.manifestPath, receiptsPath: item.receiptsPath, execute: true });
  assert.equal(result.eligible, 0);
  assert.equal(result.retained, 2);
  assert.ok(result.rows.every((row) => row.blockers.includes("ambiguous_source_or_receipt_identity")));
  assert.ok((await stat(item.draftPath)).isFile());
});
