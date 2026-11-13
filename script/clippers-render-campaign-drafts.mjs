import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const DEFAULT_TARGET = 5;
const MAX_TARGET = 5;
const MAX_PER_CAMPAIGN = 2;
const MAX_SNAPSHOT_AGE_HOURS = 48;
const MIN_DURATION_SECONDS = 5;
const MAX_DURATION_SECONDS = 180;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeHandle(value) {
  return clean(value).replace(/^@/, "").toLowerCase();
}

function safeName(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

function campaignSlug(value) {
  const readable = safeName(value);
  if (!readable) return "";
  const identity = createHash("sha256").update(clean(value)).digest("hex").slice(0, 10);
  return `${readable}-${identity}`;
}

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

async function jsonFile(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function containedRegularFile(root, candidate) {
  const rootPath = path.resolve(root);
  const candidatePath = path.resolve(rootPath, clean(candidate).replace(/^\/clippers-workspace\//, ""));
  const relative = path.relative(rootPath, candidatePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const [rootReal, candidateReal, info] = await Promise.all([
    realpath(rootPath).catch(() => null),
    realpath(candidatePath).catch(() => null),
    lstat(candidatePath).catch(() => null),
  ]);
  if (!rootReal || !candidateReal || !info?.isFile() || info.isSymbolicLink()) return null;
  const realRelative = path.relative(rootReal, candidateReal);
  return realRelative && !realRelative.startsWith("..") && !path.isAbsolute(realRelative) ? candidatePath : null;
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function cutFingerprint(sourceSha256, startSeconds, durationSeconds) {
  return createHash("sha256")
    .update(`${sourceSha256}:${startSeconds.toFixed(3)}:${durationSeconds.toFixed(3)}`)
    .digest("hex");
}

async function runBinary(binary, args) {
  return execFileAsync(binary, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true });
}

async function probeMedia(filePath, run = runBinary) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=index,codec_type,codec_name,width,height:format=duration",
    "-of", "json",
    filePath,
  ]);
  const parsed = JSON.parse(stdout);
  return {
    durationSeconds: Number(parsed.format?.duration),
    video: parsed.streams?.find((stream) => stream.codec_type === "video") || null,
    audio: parsed.streams?.find((stream) => stream.codec_type === "audio") || null,
  };
}

function srtSeconds(value) {
  const match = clean(value).match(/^(\d{2}):(\d{2}):(\d{2})[,\.](\d{3})$/);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000 : NaN;
}

function parseSrt(value, durationSeconds) {
  return String(value || "").replace(/\r/g, "").trim().split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    const timing = lines.findIndex((line) => line.includes(" --> "));
    if (timing < 0) return null;
    const [startValue, endValue] = lines[timing].split(" --> ");
    const start = Math.max(0, srtSeconds(startValue));
    const end = Math.min(durationSeconds, srtSeconds(endValue));
    const caption = lines.slice(timing + 1).join(" ")
      .replace(/<[^>]*>/g, "")
      .replace(/[\u0000-\u001f@%\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    return Number.isFinite(start) && Number.isFinite(end) && end > start && caption ? { start, end, caption } : null;
  }).filter(Boolean).sort((a, b) => a.start - b.start);
}

async function prepareSubtitleOverlay(subtitlePath, outputPath, durationSeconds, run) {
  const tempDir = `${outputPath}.${process.pid}.${Date.now()}.captions`;
  await mkdir(tempDir, { recursive: true });
  const segments = parseSrt(await readFile(subtitlePath, "utf8"), durationSeconds);
  if (!segments.length) throw new Error("subtitle file has no valid in-range SRT cues");
  const blank = path.join(tempDir, "blank.png");
  await run("magick", ["-size", "900x300", "canvas:none", blank]);
  const concat = ["ffconcat version 1.0"];
  let cursor = 0;
  for (const [index, segment] of segments.entries()) {
    if (segment.start > cursor) concat.push(`file '${blank}'`, `duration ${(segment.start - cursor).toFixed(3)}`);
    const imagePath = path.join(tempDir, `caption-${String(index).padStart(3, "0")}.png`);
    await run("magick", [
      "-background", "none", "-fill", "white", "-stroke", "black", "-strokewidth", "3",
      "-font", "Arial-Bold", "-pointsize", "58", "-gravity", "center", "-size", "900x300",
      `caption:${segment.caption}`, imagePath,
    ]);
    concat.push(`file '${imagePath}'`, `duration ${(segment.end - segment.start).toFixed(3)}`);
    cursor = segment.end;
  }
  if (cursor < durationSeconds) concat.push(`file '${blank}'`, `duration ${(durationSeconds - cursor).toFixed(3)}`);
  concat.push(`file '${blank}'`);
  const concatPath = path.join(tempDir, "captions.ffconcat");
  await writeFile(concatPath, `${concat.join("\n")}\n`, "utf8");
  return { tempDir, concatPath, cueCount: segments.length };
}

function isCampaignCurrent(campaign, now, account) {
  const observed = Date.parse(clean(campaign.observedAt));
  const expiry = Date.parse(clean(campaign.expiresAt));
  const rightsExpiry = Date.parse(clean(campaign.rightsExpiresAt || campaign.expiresAt));
  return campaign.active === true
    && campaign.joined === true
    && campaign.evidenceVerified === true
    && normalizeHandle(campaign.accountHandle) === account
    && Number.isFinite(observed)
    && observed <= now.getTime() + 5 * 60_000
    && now.getTime() - observed <= MAX_SNAPSHOT_AGE_HOURS * 3_600_000
    && Number.isFinite(expiry) && expiry > now.getTime()
    && Number.isFinite(rightsExpiry) && rightsExpiry > now.getTime();
}

function ledgerRows(value) {
  if (Array.isArray(value)) return value;
  for (const key of ["items", "entries", "posts", "results", "clips", "rendered"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function buildDedupeIndex(...values) {
  const index = { draftFiles: new Set(), mediaHashes: new Set(), cutFingerprints: new Set() };
  for (const value of values) {
    for (const row of ledgerRows(value)) {
      for (const draft of [row?.draftFile, row?.outputFile, row?.targetPath]) {
        if (clean(draft)) index.draftFiles.add(clean(draft));
      }
      for (const hash of [row?.sha256, row?.mediaSha256, row?.outputSha256]) {
        if (SHA256_PATTERN.test(clean(hash))) index.mediaHashes.add(clean(hash).toLowerCase());
      }
      if (SHA256_PATTERN.test(clean(row?.cutFingerprint))) index.cutFingerprints.add(clean(row.cutFingerprint).toLowerCase());
    }
  }
  return index;
}

async function loadCutManifests(workspaceRoot, manifestDir) {
  const names = (await readdir(manifestDir).catch(() => [])).filter((name) => name.endsWith(".json")).sort();
  const manifests = [];
  const blockers = [];
  for (const name of names) {
    const filePath = await containedRegularFile(workspaceRoot, path.join(manifestDir, name));
    if (!filePath) {
      blockers.push({ campaignId: null, cutId: null, reason: "cut_manifest_missing_or_unsafe", file: name });
      continue;
    }
    const manifest = await jsonFile(filePath, null);
    if (!manifest || Number(manifest.schemaVersion) !== 1 || !clean(manifest.campaignId) || !Array.isArray(manifest.cuts)) {
      blockers.push({ campaignId: clean(manifest?.campaignId) || null, cutId: null, reason: "cut_manifest_invalid", file: name });
      continue;
    }
    manifests.push({ ...manifest, manifestPath: path.relative(workspaceRoot, filePath) });
  }
  return { manifests, blockers };
}

async function verifyRights(workspaceRoot, campaign) {
  const evidence = await containedRegularFile(workspaceRoot, campaign.rightsEvidencePath);
  if (!evidence) return false;
  const body = (await readFile(evidence, "utf8").catch(() => "")).toLowerCase();
  return body.includes(clean(campaign.id).toLowerCase())
    && body.includes(clean(campaign.marketplace).toLowerCase())
    && body.includes(clean(campaign.sourceUrl).toLowerCase());
}

async function validateCut(workspaceRoot, campaign, manifest, cut, now, account, run) {
  const cutId = safeName(cut.id);
  if (!cutId) return { blocker: "cut_id_missing" };
  if (!campaignSlug(campaign.id)) return { blocker: "campaign_id_unsafe" };
  if (normalizeHandle(manifest.accountHandle || campaign.accountHandle) !== account) return { blocker: "wrong_account" };
  if (!isCampaignCurrent(campaign, now, account)) return { blocker: "campaign_not_current_or_authorized" };
  if (!(await verifyRights(workspaceRoot, campaign))) return { blocker: "rights_evidence_missing_or_mismatched" };
  const sourcePath = await containedRegularFile(workspaceRoot, cut.sourceFile);
  if (!sourcePath) return { blocker: "source_file_missing_or_unsafe" };
  const startSeconds = Number(cut.startSeconds);
  const durationSeconds = Number.isFinite(Number(cut.durationSeconds))
    ? Number(cut.durationSeconds)
    : Number(cut.endSeconds) - startSeconds;
  if (!Number.isFinite(startSeconds) || startSeconds < 0) return { blocker: "cut_start_invalid" };
  if (!Number.isFinite(durationSeconds) || durationSeconds < MIN_DURATION_SECONDS || durationSeconds > MAX_DURATION_SECONDS) {
    return { blocker: "cut_duration_invalid" };
  }
  let sourceProbe;
  try {
    sourceProbe = await probeMedia(sourcePath, run);
  } catch {
    return { blocker: "source_ffprobe_failed" };
  }
  if (!sourceProbe.video) return { blocker: "source_video_missing" };
  if (!sourceProbe.audio) return { blocker: "source_audio_missing" };
  if (!Number.isFinite(sourceProbe.durationSeconds) || startSeconds + durationSeconds > sourceProbe.durationSeconds + 0.05) {
    return { blocker: "cut_outside_source_duration" };
  }
  let subtitlePath = null;
  if (clean(cut.subtitleFile)) {
    subtitlePath = await containedRegularFile(workspaceRoot, cut.subtitleFile);
    if (!subtitlePath || path.extname(subtitlePath).toLowerCase() !== ".srt") {
      return { blocker: "subtitle_file_missing_or_unsafe" };
    }
  }
  const sourceSha256 = await sha256File(sourcePath);
  if (clean(cut.sourceSha256) && clean(cut.sourceSha256).toLowerCase() !== sourceSha256) return { blocker: "source_hash_mismatch" };
  return { cutId, sourcePath, subtitlePath, startSeconds, durationSeconds, sourceSha256 };
}

async function extractEvidenceFrames(outputPath, evidenceDir, durationSeconds, run) {
  const tempDir = `${evidenceDir}.${process.pid}.${Date.now()}.tmp`;
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });
  const positions = [
    ["start", Math.min(0.25, durationSeconds / 4)],
    ["middle", durationSeconds / 2],
    ["end", Math.max(0, durationSeconds - 0.25)],
  ];
  const frames = [];
  try {
    for (const [label, seconds] of positions) {
      const frame = path.join(tempDir, `${label}.jpg`);
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", seconds.toFixed(3), "-i", outputPath, "-frames:v", "1", "-q:v", "2", frame]);
      if ((await stat(frame)).size < 100) throw new Error(`empty ${label} frame`);
      frames.push({ label, seconds: Number(seconds.toFixed(3)), file: path.basename(frame), sha256: await sha256File(frame) });
    }
    await rm(evidenceDir, { recursive: true, force: true });
    await rename(tempDir, evidenceDir);
    return frames;
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function renderCut({ workspaceRoot, outputDir, campaign, cut, checked, run }) {
  const campaignSlugValue = campaignSlug(campaign.id);
  const outputName = `${campaignSlugValue}-${checked.cutId}.mp4`;
  const outputPath = path.join(outputDir, campaignSlugValue, outputName);
  const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp.mp4`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  const baseVideo = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1";
  let subtitleOverlay = null;
  if (checked.subtitlePath) subtitleOverlay = await prepareSubtitleOverlay(checked.subtitlePath, outputPath, checked.durationSeconds, run);
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", checked.startSeconds.toFixed(3), "-t", checked.durationSeconds.toFixed(3), "-i", checked.sourcePath,
  ];
  if (subtitleOverlay) {
    args.push(
      "-f", "concat", "-safe", "0", "-i", subtitleOverlay.concatPath,
      "-filter_complex", `[0:v]${baseVideo}[base];[base][1:v]overlay=(W-w)/2:H*0.70-h/2:shortest=1[v]`,
      "-map", "[v]", "-map", "0:a:0",
    );
  } else {
    args.push("-map", "0:v:0", "-map", "0:a:0", "-vf", baseVideo);
  }
  args.push(
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", "-map_metadata", "-1", "-metadata", `comment=clippers:${campaign.id}:${checked.cutId}:cost-usd-0`,
    tempPath,
  );
  try {
    await run("ffmpeg", args);
    const outputProbe = await probeMedia(tempPath, run);
    if (outputProbe.video?.width !== 1080 || outputProbe.video?.height !== 1920 || !outputProbe.audio) {
      throw new Error("rendered media failed 9:16/audio verification");
    }
    if (!Number.isFinite(outputProbe.durationSeconds) || Math.abs(outputProbe.durationSeconds - checked.durationSeconds) > 0.35) {
      throw new Error("rendered media duration mismatch");
    }
    const outputSha256 = await sha256File(tempPath);
    await rename(tempPath, outputPath);
    const evidenceDir = path.join(outputDir, campaignSlugValue, "evidence", checked.cutId);
    const frames = await extractEvidenceFrames(outputPath, evidenceDir, outputProbe.durationSeconds, run);
    return {
      campaignId: campaign.id,
      cutId: checked.cutId,
      sourceFile: path.relative(workspaceRoot, checked.sourcePath),
      sourceSha256: checked.sourceSha256,
      cutFingerprint: cutFingerprint(checked.sourceSha256, checked.startSeconds, checked.durationSeconds),
      startSeconds: checked.startSeconds,
      durationSeconds: checked.durationSeconds,
      subtitleFile: checked.subtitlePath ? path.relative(workspaceRoot, checked.subtitlePath) : null,
      subtitlesApplied: Boolean(checked.subtitlePath),
      draftFile: path.relative(workspaceRoot, outputPath),
      outputSha256,
      probe: { width: outputProbe.video.width, height: outputProbe.video.height, audioCodec: outputProbe.audio.codec_name, durationSeconds: outputProbe.durationSeconds },
      evidenceFrames: frames.map((frame) => ({ ...frame, file: path.relative(workspaceRoot, path.join(evidenceDir, frame.file)) })),
      costUsd: 0,
    };
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  } finally {
    if (subtitleOverlay?.tempDir) await rm(subtitleOverlay.tempDir, { recursive: true, force: true });
  }
}

export async function renderCampaignDrafts(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (!Number.isFinite(now.getTime())) throw new Error("invalid renderer timestamp");
  const requestedTarget = Number(options.targetDailyClips ?? process.env.CLIPPERS_TARGET_DAILY_CLIPS ?? DEFAULT_TARGET);
  const targetDailyClips = Math.max(0, Math.min(MAX_TARGET, Math.trunc(Number.isFinite(requestedTarget) ? requestedTarget : DEFAULT_TARGET)));
  const account = normalizeHandle(options.account || process.env.CLIPPERS_TIKTOK_ACCOUNT || "streamersclipusa");
  const campaignsPath = path.join(workspaceRoot, "research", "paid-streamer-campaigns.json");
  const manifestDir = path.join(workspaceRoot, "research", "campaign-cut-manifests");
  const outputDir = path.join(workspaceRoot, "drafts", "campaigns");
  const reportPath = path.join(workspaceRoot, "reports", "campaign-draft-renderer.json");
  const rendererLedgerPath = path.join(workspaceRoot, "reports", "campaign-draft-renderer-ledger.json");
  const campaigns = await jsonFile(campaignsPath, []);
  const deliveryLedger = await jsonFile(path.join(workspaceRoot, "reports", "metricool-autopilot-ledger.json"), []);
  const previousReport = await jsonFile(reportPath, {});
  const rendererLedger = await jsonFile(rendererLedgerPath, []);
  const mediaReceipts = await jsonFile(path.join(workspaceRoot, "reports", "metricool-public-media-receipts.json"), []);
  const dedupe = buildDedupeIndex(deliveryLedger, rendererLedger, previousReport, mediaReceipts);
  const loaded = await loadCutManifests(workspaceRoot, manifestDir);
  const campaignById = new Map((Array.isArray(campaigns) ? campaigns : []).map((campaign) => [clean(campaign.id), campaign]));
  const blockers = [...loaded.blockers];
  const candidates = [];
  const run = options.runBinary || runBinary;
  for (const manifest of loaded.manifests) {
    const campaign = campaignById.get(clean(manifest.campaignId));
    if (!campaign) {
      blockers.push({ campaignId: manifest.campaignId, cutId: null, reason: "campaign_not_in_authorized_catalog" });
      continue;
    }
    for (const cut of manifest.cuts) {
      const checked = await validateCut(workspaceRoot, campaign, manifest, cut, now, account, run);
      if (checked.blocker) {
        blockers.push({ campaignId: campaign.id, cutId: clean(cut?.id) || null, reason: checked.blocker });
        continue;
      }
      const fingerprint = cutFingerprint(checked.sourceSha256, checked.startSeconds, checked.durationSeconds);
      const slug = campaignSlug(campaign.id);
      const expectedDraft = path.relative(workspaceRoot, path.join(outputDir, slug, `${slug}-${checked.cutId}.mp4`));
      if (dedupe.cutFingerprints.has(fingerprint) || dedupe.draftFiles.has(expectedDraft)) {
        blockers.push({ campaignId: campaign.id, cutId: checked.cutId, reason: "duplicate_source_range_or_draft" });
        continue;
      }
      candidates.push({ campaign, manifest, cut, checked });
    }
  }
  const selected = [];
  const perCampaign = new Map();
  for (const candidate of candidates.sort((a, b) => clean(a.campaign.id).localeCompare(clean(b.campaign.id)) || a.checked.cutId.localeCompare(b.checked.cutId))) {
    if (selected.length >= targetDailyClips) break;
    const count = perCampaign.get(candidate.campaign.id) || 0;
    if (count >= MAX_PER_CAMPAIGN) {
      blockers.push({ campaignId: candidate.campaign.id, cutId: candidate.checked.cutId, reason: "daily_campaign_diversity_limit" });
      continue;
    }
    selected.push(candidate);
    perCampaign.set(candidate.campaign.id, count + 1);
  }
  const rendered = [];
  for (const selectedCut of selected) {
    try {
      const result = await renderCut({ workspaceRoot, outputDir, ...selectedCut, run });
      if (dedupe.mediaHashes.has(result.outputSha256)) {
        await rm(path.resolve(workspaceRoot, result.draftFile), { force: true });
        blockers.push({ campaignId: result.campaignId, cutId: result.cutId, reason: "duplicate_output_hash" });
        continue;
      }
      rendered.push(result);
      dedupe.mediaHashes.add(result.outputSha256);
      dedupe.cutFingerprints.add(result.cutFingerprint);
    } catch (error) {
      const diagnostic = clean(error?.stderr || error?.message).replace(/\s+/g, " ");
      blockers.push({ campaignId: selectedCut.campaign.id, cutId: selectedCut.checked.cutId, reason: "render_or_qa_failed", detail: diagnostic.slice(0, 500) });
    }
  }
  const report = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    status: rendered.length === targetDailyClips ? "ready" : rendered.length ? "partial" : "blocked",
    account,
    targetDailyClips,
    maximumPerCampaign: MAX_PER_CAMPAIGN,
    networkAccessUsed: false,
    paidAiUsed: false,
    costUsd: 0,
    summary: {
      authorizedCampaigns: campaignById.size,
      manifestsRead: loaded.manifests.length,
      eligibleCuts: candidates.length,
      selected: selected.length,
      rendered: rendered.length,
      missingAgainstTarget: Math.max(0, targetDailyClips - rendered.length),
      blocked: blockers.length,
    },
    rendered,
    blockers,
  };
  if (rendered.length) {
    const retained = Array.isArray(rendererLedger) ? rendererLedger : ledgerRows(rendererLedger);
    const combined = [...retained, ...rendered];
    const uniqueByFingerprint = [...new Map(combined.map((row) => [clean(row.cutFingerprint) || clean(row.outputSha256) || clean(row.draftFile), row])).values()];
    await atomicJson(rendererLedgerPath, uniqueByFingerprint);
  }
  await atomicJson(reportPath, report);
  if (options.updateCampaignCatalog !== false && rendered.length) {
    const updated = campaigns.map((campaign) => {
      const additions = rendered.filter((row) => row.campaignId === campaign.id).map((row) => row.draftFile);
      if (!additions.length) return campaign;
      const draftFiles = [...new Set([...(Array.isArray(campaign.draftFiles) ? campaign.draftFiles : []), ...additions])];
      return { ...campaign, draftFiles, draftsReady: draftFiles.length };
    });
    await atomicJson(campaignsPath, updated);
  }
  return report;
}

async function main() {
  const report = await renderCampaignDrafts();
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "blocked") process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
