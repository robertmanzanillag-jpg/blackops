import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  DRIVE_CLIPPERS_MEDIA_FOLDER,
  ensureAppDriveFolderPath,
  ensureDriveFilePublicDownload,
  uploadLocalFileToDriveFolder,
} from "../server/google-drive";
import {
  buildStreamerGrowthCeoPlan,
  resolveAssignmentFinalMediaPath,
  resolveWorkspaceMediaPath,
  validateMetricoolMp4,
  verifyTextEvidence,
} from "./clippers-streamer-growth-ceo.mjs";
import { loadClipperSelectedEnv } from "./clippers-selected-env.mjs";

type Campaign = Record<string, any> & {
  id: string;
  marketplace: string;
  sourceUrl: string;
  rightsEvidencePath: string;
  publicMediaUrls?: Record<string, string>;
  metricoolBlogId?: number;
};

type UploadReceipt = {
  campaignId: string;
  draftFile: string;
  fileId: string;
  mediaUrl: string;
  sha256: string;
  sizeBytes: number;
  uploadedAt: string;
  status?: "upload_pending_publication" | "ready";
  error?: string;
  paidSpendAllowed: false;
};

type UploadDependencies = {
  ensureFolder: (campaignId: string) => Promise<string>;
  uploadFile: (input: { filePath: string; folderId: string; mimeType: string }) => Promise<{ fileId: string }>;
  makePublic: (fileId: string) => Promise<string>;
  verifyPublicUrl: (url: string) => Promise<boolean>;
};

function realValue(value: unknown): string {
  const cleaned = String(value || "").trim();
  if (!cleaned || /^(?:changeme|replace|example|todo|your[-_ ])/i.test(cleaned)) return "";
  return cleaned;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

async function fileSha256(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function enrichPreparedMedia(workspaceRoot: string, campaigns: Campaign[]) {
  for (const campaign of campaigns) {
    campaign.draftMetadata ||= {};
    for (const draftFile of Array.isArray(campaign.draftFiles) ? campaign.draftFiles : []) {
      const basename = path.basename(draftFile);
      const extension = path.extname(basename);
      const stem = path.basename(basename, extension);
      const metadata = campaign.draftMetadata[basename] ||= {};
      const original = resolveWorkspaceMediaPath(workspaceRoot, draftFile);
      const candidates = [
        { filePath: path.join(path.dirname(original), "subtitled", `${stem}-clean_sentence.mp4`), style: "clean_sentence" },
        { filePath: path.join(path.dirname(original), "subtitled", `${stem}-word_by_word.mp4`), style: "word_by_word" },
        { filePath: original, style: "hook_only" },
      ];
      for (const candidate of candidates) {
        if (await access(candidate.filePath).then(() => true).catch(() => false)) {
          metadata.finalMediaFile = path.relative(workspaceRoot, candidate.filePath);
          metadata.subtitleStyle = candidate.style;
          metadata.requiresTranscript = false;
          metadata.preparationStatus = candidate.style === "hook_only"
            ? "ready_with_campaign_hook"
            : "ready_with_local_subtitles";
          break;
        }
      }
    }
  }
}

export async function verifyPublicMetricoolMediaUrl(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetcher(url, {
    headers: { Range: "bytes=0-0" },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (![200, 206].includes(response.status)) return false;
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  return contentType.startsWith("video/")
    || contentType.includes("application/octet-stream")
    || contentType.includes("application/mp4");
}

export async function runClipperMetricoolMediaUpload(options: {
  workspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
  dependencies?: UploadDependencies;
  dryRun?: boolean;
} = {}) {
  const env = options.env || process.env;
  const dryRun = options.dryRun === true || env.CLIPPERS_PUBLIC_MEDIA_DRY_RUN === "true";
  if (!dryRun && env.CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED !== "true") {
    return { status: "blocked", reason: "explicit_public_media_upload_authorization_required", uploaded: 0 };
  }
  if ((realValue(env.CLIPPERS_PUBLIC_MEDIA_PROVIDER) || "google_drive") !== "google_drive") {
    return { status: "blocked", reason: "unsupported_public_media_provider", uploaded: 0 };
  }
  const expectedBlogId = Number(realValue(env.CLIPPERS_METRICOOL_BLOG_ID));
  if (!Number.isInteger(expectedBlogId) || expectedBlogId <= 0) {
    return { status: "blocked", reason: "metricool_blog_id_missing", uploaded: 0 };
  }
  const expectedAccount = (realValue(env.CLIPPERS_TIKTOK_ACCOUNT) || "streamersclipusa")
    .replace(/^@/, "").toLowerCase();

  const workspaceRoot = path.resolve(options.workspaceRoot || env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
  const researchDir = path.join(workspaceRoot, "research");
  const reportDir = path.join(workspaceRoot, "reports");
  const campaignsPath = path.join(researchDir, "paid-streamer-campaigns.json");
  const metricsPath = path.join(researchDir, "paid-streamer-campaign-metrics.json");
  const receiptsPath = path.join(reportDir, "metricool-public-media-receipts.json");
  const deliveryLedgerPath = path.join(reportDir, "metricool-autopilot-ledger.json");
  const campaigns = JSON.parse(await readFile(campaignsPath, "utf8").catch(() => "[]")) as Campaign[];
  const metrics = JSON.parse(await readFile(metricsPath, "utf8").catch(() => "[]"));
  const receipts = JSON.parse(await readFile(receiptsPath, "utf8").catch(() => "[]")) as UploadReceipt[];
  const deliveryLedger = JSON.parse(await readFile(deliveryLedgerPath, "utf8").catch(() => "[]"));
  const receiptByDraft = new Map(receipts.map((receipt) => [receipt.draftFile, receipt]));
  const receiptByHash = new Map(receipts.filter((receipt) => receipt.sha256)
    .map((receipt) => [receipt.sha256, receipt]));
  const deliveredFiles = new Set((Array.isArray(deliveryLedger) ? deliveryLedger : [])
    .filter((row) => ["scheduled", "published", "verification_pending"].includes(String(row?.status || "").toLowerCase()))
    .map((row) => String(row?.draftFile || "").trim())
    .filter(Boolean));

  await enrichPreparedMedia(workspaceRoot, campaigns);
  for (const campaign of campaigns) {
    campaign.evidenceVerified = await verifyTextEvidence(workspaceRoot, campaign.rightsEvidencePath, [
      campaign.id,
      campaign.marketplace,
      campaign.sourceUrl,
    ]);
  }
  const plan = buildStreamerGrowthCeoPlan({
    campaigns,
    metrics,
    publishingAuthorized: true,
    targetDailyClips: env.CLIPPERS_TARGET_DAILY_CLIPS || 5,
  });
  const dependencies = options.dependencies || {
    ensureFolder: (campaignId) => ensureAppDriveFolderPath([DRIVE_CLIPPERS_MEDIA_FOLDER, campaignId]),
    uploadFile: (input) => uploadLocalFileToDriveFolder(input),
    makePublic: (fileId) => ensureDriveFilePublicDownload({ fileId }),
    verifyPublicUrl: (url) => verifyPublicMetricoolMediaUrl(url),
  };
  const uploaded: UploadReceipt[] = [];
  const wouldUpload: Array<{ campaignId: string; draftFile: string; sha256: string; sizeBytes: number }> = [];
  let reused = 0;
  let skippedDelivered = 0;
  const blocked: Array<{ campaignId: string; draftFile: string | null; reason: string }> = [];

  for (const decision of plan.decisions) {
    const campaign = campaigns.find((row) => row.id === decision.campaignId);
    if (!campaign || !decision.canProduce) {
      blocked.push({
        campaignId: decision.campaignId,
        draftFile: null,
        reason: decision.productionBlockers?.[0] || "campaign_not_eligible",
      });
      continue;
    }
    const campaignAccount = String(campaign.accountHandle || "").replace(/^@/, "").toLowerCase();
    if (campaignAccount !== expectedAccount) {
      blocked.push({ campaignId: campaign.id, draftFile: null, reason: "wrong_account" });
      continue;
    }
    if (campaign.metricoolBlogId !== undefined && Number(campaign.metricoolBlogId) !== expectedBlogId) {
      blocked.push({ campaignId: campaign.id, draftFile: null, reason: "wrong_metricool_blog" });
      continue;
    }
    campaign.publicMediaUrls ||= {};
    campaign.metricoolBlogId = expectedBlogId;
    let folderId = "dry-run";
    if (!dryRun) {
      try {
        folderId = await dependencies.ensureFolder(campaign.id);
      } catch (error) {
        blocked.push({
          campaignId: campaign.id,
          draftFile: null,
          reason: `drive_folder_failed:${String((error as Error)?.message || error).slice(0, 160)}`,
        });
        continue;
      }
    }
    for (const assignment of decision.assignments || []) {
      const draftFile = String(assignment.draftFile || "").trim();
      if (!draftFile) continue;
      if (deliveredFiles.has(draftFile) || deliveredFiles.has(String(assignment.finalMediaFile || "").trim())) {
        skippedDelivered += 1;
        continue;
      }
      const mediaPath = resolveAssignmentFinalMediaPath(workspaceRoot, assignment);
      const validated = await validateMetricoolMp4(workspaceRoot, mediaPath);
      if (!validated) {
        blocked.push({ campaignId: campaign.id, draftFile, reason: "validated_mp4_missing" });
        continue;
      }
      const fileInfo = await stat(validated);
      const sha256 = await fileSha256(validated);
      if (dryRun) {
        wouldUpload.push({ campaignId: campaign.id, draftFile, sha256, sizeBytes: fileInfo.size });
        continue;
      }
      const existing = receiptByDraft.get(draftFile) || receiptByHash.get(sha256);
      if (existing?.sha256 === sha256 && existing.fileId) {
        let mediaUrl = existing.mediaUrl;
        let reachable = /^https:\/\//i.test(mediaUrl) && await dependencies.verifyPublicUrl(mediaUrl).catch(() => false);
        try {
          if (!reachable) {
            mediaUrl = await dependencies.makePublic(existing.fileId);
            reachable = await dependencies.verifyPublicUrl(mediaUrl);
          }
        } catch (error) {
          const pending: UploadReceipt = {
            ...existing,
            campaignId: campaign.id,
            draftFile,
            sha256,
            sizeBytes: fileInfo.size,
            status: "upload_pending_publication",
            error: String((error as Error)?.message || error).slice(0, 300),
            paidSpendAllowed: false,
          };
          receiptByDraft.set(draftFile, pending);
          receiptByHash.set(sha256, pending);
          await writeJsonAtomic(receiptsPath, [...receiptByDraft.values()]);
          blocked.push({ campaignId: campaign.id, draftFile, reason: "public_media_verification_failed" });
          continue;
        }
        if (reachable) {
          const reusedReceipt = {
            ...existing,
            campaignId: campaign.id,
            draftFile,
            mediaUrl,
            sha256,
            sizeBytes: fileInfo.size,
            status: "ready" as const,
            error: undefined,
          };
          receiptByDraft.set(draftFile, reusedReceipt);
          receiptByHash.set(sha256, reusedReceipt);
          campaign.publicMediaUrls[draftFile] = mediaUrl;
          campaign.publicMediaUrls[path.basename(draftFile)] = mediaUrl;
          reused += 1;
          await writeJsonAtomic(receiptsPath, [...receiptByDraft.values()]);
          await writeJsonAtomic(campaignsPath, campaigns);
          continue;
        }
        const pending: UploadReceipt = {
          ...existing,
          campaignId: campaign.id,
          draftFile,
          sha256,
          sizeBytes: fileInfo.size,
          status: "upload_pending_publication",
          error: "public URL is unreachable or not video media",
          paidSpendAllowed: false,
        };
        receiptByDraft.set(draftFile, pending);
        receiptByHash.set(sha256, pending);
        await writeJsonAtomic(receiptsPath, [...receiptByDraft.values()]);
        blocked.push({ campaignId: campaign.id, draftFile, reason: "public_media_url_unreachable" });
        continue;
      }
      let upload: { fileId: string };
      try {
        upload = await dependencies.uploadFile({
          filePath: validated,
          folderId,
          mimeType: "video/mp4",
        });
      } catch (error) {
        blocked.push({
          campaignId: campaign.id,
          draftFile,
          reason: `media_upload_failed:${String((error as Error)?.message || error).slice(0, 160)}`,
        });
        continue;
      }
      if (!realValue(upload.fileId)) {
        blocked.push({ campaignId: campaign.id, draftFile, reason: "media_upload_receipt_missing_file_id" });
        continue;
      }
      const provisional: UploadReceipt = {
        campaignId: campaign.id,
        draftFile,
        fileId: upload.fileId,
        mediaUrl: "",
        sha256,
        sizeBytes: fileInfo.size,
        uploadedAt: new Date().toISOString(),
        status: "upload_pending_publication",
        paidSpendAllowed: false,
      };
      receiptByDraft.set(draftFile, provisional);
      receiptByHash.set(sha256, provisional);
      await writeJsonAtomic(receiptsPath, [...receiptByDraft.values()]);
      let mediaUrl = "";
      try {
        mediaUrl = await dependencies.makePublic(upload.fileId);
        if (!await dependencies.verifyPublicUrl(mediaUrl)) throw new Error("public URL is unreachable or not video media");
      } catch (error) {
        provisional.error = String((error as Error)?.message || error).slice(0, 300);
        await writeJsonAtomic(receiptsPath, [...receiptByDraft.values()]);
        blocked.push({ campaignId: campaign.id, draftFile, reason: "public_media_url_unreachable" });
        continue;
      }
      const receipt: UploadReceipt = { ...provisional, mediaUrl, status: "ready", error: undefined };
      receiptByDraft.set(draftFile, receipt);
      receiptByHash.set(sha256, receipt);
      uploaded.push(receipt);
      campaign.publicMediaUrls[draftFile] = mediaUrl;
      campaign.publicMediaUrls[path.basename(draftFile)] = mediaUrl;
      await writeJsonAtomic(receiptsPath, [...receiptByDraft.values()]);
      await writeJsonAtomic(campaignsPath, campaigns);
    }
  }
  if (!dryRun) {
    await writeJsonAtomic(receiptsPath, [...receiptByDraft.values()]);
    await writeJsonAtomic(campaignsPath, campaigns);
  }
  return {
    status: dryRun ? "dry_run" : blocked.length ? (uploaded.length ? "partial" : "blocked") : "completed",
    dryRun,
    provider: "google_drive",
    uploaded: uploaded.length,
    wouldUpload: wouldUpload.length,
    dryRunItems: wouldUpload,
    reused,
    skippedDelivered,
    blocked,
    paidSpendAllowed: false,
    receiptsPath,
  };
}

async function main() {
  loadClipperSelectedEnv(process.cwd());
  const result = await runClipperMetricoolMediaUpload();
  console.log(JSON.stringify(result, null, 2));
  if (!["completed", "partial"].includes(result.status)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
