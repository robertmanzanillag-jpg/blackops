import { createHash } from "node:crypto";
import { appendFile, lstat, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const exactTikTokPostPattern = /^https:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._-]{2,40})\/video\/(\d{8,30})\/?$/i;

function containedPath(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? resolvedCandidate : null;
}

async function sha256(filePath) {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

async function containedExistingFile(root, candidate) {
  const lexicalPath = containedPath(root, candidate);
  if (!lexicalPath) return null;
  const [rootReal, fileReal, linkStat] = await Promise.all([
    realpath(root).catch(() => null),
    realpath(lexicalPath).catch(() => null),
    lstat(lexicalPath).catch(() => null),
  ]);
  if (!rootReal || !fileReal || !linkStat?.isFile() || linkStat.isSymbolicLink()) return null;
  const relative = path.relative(rootReal, fileReal);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? lexicalPath : null;
}

async function localProofReady(root, proofPath, publishedPostUrl, requiredText) {
  const evidenceRoot = path.join(root, "evidence-drop");
  const resolved = await containedExistingFile(evidenceRoot, String(proofPath || ""));
  if (!resolved) return false;
  const proof = await readFile(resolved, "utf8").catch(() => "");
  return proof.length >= 80
    && proof.includes(publishedPostUrl)
    && proof.toLowerCase().includes(requiredText.toLowerCase())
    && !/<[^>]+>|placeholder|paste here/i.test(proof);
}

export async function cleanupPublishedVyroMedia({ workspaceRoot, manifestPath, receiptsPath, execute = false }) {
  const root = path.resolve(workspaceRoot);
  const resolvedManifest = containedPath(root, manifestPath);
  const resolvedReceipts = containedPath(root, receiptsPath);
  if (!resolvedManifest || !resolvedReceipts) throw new Error("Manifest and receipts must stay inside the Clippers workspace.");
  if (!(await containedExistingFile(root, resolvedManifest)) || !(await containedExistingFile(root, resolvedReceipts))) {
    throw new Error("Manifest and receipts must be real local files, not symlinks.");
  }

  const manifest = JSON.parse(await readFile(resolvedManifest, "utf8"));
  const receipts = JSON.parse(await readFile(resolvedReceipts, "utf8"));
  if (!Array.isArray(manifest.clips) || !Array.isArray(receipts)) throw new Error("Invalid draft manifest or publication receipts.");

  const sourceRoot = path.join(root, "source-drop", "streamers");
  const draftsRoot = path.join(root, "drafts", "vyro");
  const ledgerPath = path.join(path.dirname(resolvedManifest), "cleanup-ledger.jsonl");
  const rows = [];
  const sourceCounts = new Map();
  for (const clip of manifest.clips) {
    const sourceName = String(clip?.sourceName || "");
    sourceCounts.set(sourceName, (sourceCounts.get(sourceName) || 0) + 1);
  }

  for (const clip of manifest.clips) {
    const matchingReceipts = receipts.filter((item) => item?.sourceName === clip.sourceName);
    const ambiguousIdentity = sourceCounts.get(String(clip.sourceName || "")) !== 1 || matchingReceipts.length !== 1;
    const receipt = ambiguousIdentity ? null : matchingReceipts[0];
    const postMatch = exactTikTokPostPattern.exec(String(receipt?.publishedPostUrl || "").trim());
    const accountMatches = postMatch?.[1]?.toLowerCase() === String(manifest.account || "").toLowerCase();
    const metricoolProofReady = receipt && await localProofReady(root, receipt.metricoolProofPath, receipt.publishedPostUrl, "Metricool");
    const vyroProofReady = receipt && await localProofReady(root, receipt.vyroSubmissionProofPath, receipt.publishedPostUrl, String(manifest.campaignId || "Vyro"));
    const proofReady = Boolean(
      receipt
      && !ambiguousIdentity
      && postMatch
      && accountMatches
      && receipt.metricoolStatus === "published"
      && receipt.vyroSubmissionStatus === "submitted"
      && Number.isFinite(Date.parse(String(receipt.publishedAt || "")))
      && metricoolProofReady
      && vyroProofReady
    );

    const sourceCandidate = containedPath(sourceRoot, path.join(sourceRoot, path.basename(String(clip.sourceName || ""))));
    const draftCandidate = containedPath(draftsRoot, String(clip.targetPath || ""));
    const sourcePath = sourceCandidate ? await containedExistingFile(sourceRoot, sourceCandidate) : null;
    const draftPath = draftCandidate ? await containedExistingFile(draftsRoot, draftCandidate) : null;
    const hookPath = draftPath ? path.join(path.dirname(draftPath), `${path.parse(String(clip.sourceName || "")).name}-hook.png`) : null;
    const hookFile = hookPath ? await containedExistingFile(draftsRoot, hookPath) : null;
    const presentTargets = [sourcePath, draftPath, hookFile].filter(Boolean);

    if (!proofReady) {
      rows.push({
        sourceName: clip.sourceName,
        status: "retained_missing_publish_proof",
        deleted: 0,
        blockers: [
          ambiguousIdentity ? "ambiguous_source_or_receipt_identity" : null,
          !postMatch ? "exact_tiktok_url_missing" : null,
          postMatch && !accountMatches ? "tiktok_account_mismatch" : null,
          receipt?.metricoolStatus !== "published" ? "metricool_status_not_published" : null,
          receipt?.vyroSubmissionStatus !== "submitted" ? "vyro_status_not_submitted" : null,
          !Number.isFinite(Date.parse(String(receipt?.publishedAt || ""))) ? "published_timestamp_missing" : null,
          !metricoolProofReady ? "metricool_local_proof_missing" : null,
          !vyroProofReady ? "vyro_local_proof_missing" : null,
        ].filter(Boolean),
      });
      continue;
    }

    const hashes = {};
    for (const target of presentTargets) hashes[path.basename(target)] = await sha256(target);
    if (execute) {
      const ledgerRecord = {
        sourceName: clip.sourceName,
        publishedPostUrl: receipt.publishedPostUrl,
        publishedAt: receipt.publishedAt,
        metricoolStatus: receipt.metricoolStatus,
        vyroSubmissionStatus: receipt.vyroSubmissionStatus,
        hashes,
        deletedFiles: presentTargets.map((target) => path.basename(target)),
      };
      await appendFile(ledgerPath, `${JSON.stringify({ ...ledgerRecord, status: "cleanup_authorized", recordedAt: new Date().toISOString() })}\n`);
      for (const target of presentTargets) await unlink(target);
      await appendFile(ledgerPath, `${JSON.stringify({
        ...ledgerRecord,
        status: "cleanup_completed",
        recordedAt: new Date().toISOString(),
      })}\n`);
    }
    rows.push({ sourceName: clip.sourceName, status: execute ? "deleted_after_verified_publish" : "eligible_dry_run", deleted: execute ? presentTargets.length : 0 });
  }

  return {
    status: execute ? "cleanup_completed" : "cleanup_dry_run",
    execute,
    eligible: rows.filter((row) => ["eligible_dry_run", "deleted_after_verified_publish"].includes(row.status)).length,
    retained: rows.filter((row) => row.status === "retained_missing_publish_proof").length,
    deletedFiles: rows.reduce((sum, row) => sum + row.deleted, 0),
    ledgerPath,
    rows,
  };
}

async function main() {
  const workspaceRoot = path.resolve(process.env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
  const manifestPath = path.join(workspaceRoot, "drafts", "vyro", "mrbeast-jre-2026-07-21", "draft-manifest.json");
  const receiptsPath = path.join(path.dirname(manifestPath), "publication-receipts.json");
  const result = await cleanupPublishedVyroMedia({
    workspaceRoot,
    manifestPath,
    receiptsPath,
    execute: process.argv.includes("--execute"),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(fileURLToPath(import.meta.url)).href && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
