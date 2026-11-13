import { lstat, mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const supportedModes = new Set(["clean_sentence", "word_by_word"]);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited with code ${code}${signal ? ` (${signal})` : ""}`)));
  });
}

export function parseSrt(text) {
  return String(text || "").replace(/\r/g, "").trim().split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => line.includes(" --> "));
    if (timingIndex < 0) return null;
    const [start, end] = lines[timingIndex].split(" --> ").map(srtTimestampSeconds);
    const caption = lines.slice(timingIndex + 1).join(" ").replace(/\s+/g, " ").trim();
    return Number.isFinite(start) && Number.isFinite(end) && end > start && caption
      ? { start, end, caption }
      : null;
  }).filter(Boolean);
}

function srtTimestampSeconds(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2}):(\d{2})[,\.](\d{3})$/);
  if (!match) return NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function safeCaption(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

async function containedRegularFile(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const [rootReal, fileReal, fileStats] = await Promise.all([
    realpath(resolvedRoot).catch(() => null),
    realpath(resolvedCandidate).catch(() => null),
    lstat(resolvedCandidate).catch(() => null),
  ]);
  if (!rootReal || !fileReal || !fileStats?.isFile() || fileStats.isSymbolicLink()) return null;
  const relative = path.relative(rootReal, fileReal);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? resolvedCandidate : null;
}

export async function renderLocalSubtitles({ input, output, model, mode = "clean_sentence", language = "en" }) {
  if (!supportedModes.has(mode)) throw new Error(`Unsupported subtitle mode: ${mode}`);
  const inputPath = path.resolve(input);
  const outputPath = path.resolve(output);
  const modelPath = path.resolve(model);
  if (inputPath === outputPath) throw new Error("Subtitle output must not overwrite the source draft.");
  await mkdir(path.dirname(outputPath), { recursive: true });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clippers-subs-"));
  try {
    const wavPath = path.join(tempDir, "audio.wav");
    const transcriptBase = path.join(tempDir, "transcript");
    await run("ffmpeg", ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath]);
    const maxLength = mode === "word_by_word" ? "16" : "42";
    await run("whisper-cli", ["-ng", "-m", modelPath, "-f", wavPath, "-l", language, "-osrt", "-of", transcriptBase, "-sow", "-ml", maxLength, "-np"]);
    const segments = parseSrt(await readFile(`${transcriptBase}.srt`, "utf8"));
    if (!segments.length) throw new Error("Whisper produced no usable subtitle segments.");

    const imagePaths = [];
    const blankPath = path.join(tempDir, "caption-blank.png");
    await run("magick", ["-size", "540x180", "canvas:none", blankPath]);
    for (const [index, segment] of segments.entries()) {
      const imagePath = path.join(tempDir, `caption-${String(index).padStart(3, "0")}.png`);
      imagePaths.push(imagePath);
      await run("magick", [
        "-background", "none", "-fill", "white", "-stroke", "black", "-strokewidth", "2",
        "-font", "Arial-Bold", "-pointsize", mode === "word_by_word" ? "50" : "42",
        "-gravity", "center", "-size", "540x180", `caption:${safeCaption(segment.caption)}`, imagePath,
      ]);
    }

    const concatLines = ["ffconcat version 1.0"];
    let cursor = 0;
    for (const [index, segment] of segments.entries()) {
      if (segment.start > cursor) {
        concatLines.push(`file '${blankPath}'`, `duration ${(segment.start - cursor).toFixed(3)}`);
      }
      concatLines.push(`file '${imagePaths[index]}'`, `duration ${(segment.end - segment.start).toFixed(3)}`);
      cursor = segment.end;
    }
    concatLines.push(`file '${blankPath}'`, "duration 3600", `file '${blankPath}'`);
    const concatPath = path.join(tempDir, "captions.ffconcat");
    await writeFile(concatPath, `${concatLines.join("\n")}\n`);
    const ffmpegArgs = ["-y", "-i", inputPath, "-f", "concat", "-safe", "0", "-i", concatPath];
    ffmpegArgs.push(
      "-filter_complex", "[0:v][1:v]overlay=(W-w)/2:H*0.66-h/2:shortest=1[v1]",
      "-map", "[v1]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", outputPath,
    );
    await run("ffmpeg", ffmpegArgs);
    return { input: inputPath, output: outputPath, mode, segments: segments.length, apiCostUsd: 0 };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function renderAssignedBatch({ workspaceRoot, model, force = false }) {
  const root = path.resolve(workspaceRoot);
  const report = JSON.parse(await readFile(path.join(root, "reports", "streamer-growth-ceo.json"), "utf8"));
  const results = [];
  for (const decision of report.decisions || []) {
    for (const assignment of decision.assignments || []) {
      if (decision.canProduce !== true) {
        results.push({ campaignId: decision.campaignId, slot: assignment.slot, status: "skipped_blocked_campaign", apiCostUsd: 0 });
        continue;
      }
      if (!assignment.draftFile || assignment.subtitleStyle === "hook_only") {
        results.push({ campaignId: decision.campaignId, slot: assignment.slot, status: "hook_only_no_transcript", apiCostUsd: 0 });
        continue;
      }
      const input = path.resolve(root, assignment.draftFile);
      if (input !== root && !input.startsWith(`${root}${path.sep}`)) {
        throw new Error(`Draft path escapes Clippers workspace: ${assignment.draftFile}`);
      }
      if (!(await containedRegularFile(root, input))) {
        throw new Error(`Draft is missing, not a regular file, or symlinked: ${assignment.draftFile}`);
      }
      const extension = path.extname(input);
      const output = path.join(path.dirname(input), "subtitled", `${path.basename(input, extension)}-${assignment.subtitleStyle}.mp4`);
      await mkdir(path.dirname(output), { recursive: true });
      const [rootReal, outputParentReal] = await Promise.all([realpath(root), realpath(path.dirname(output))]);
      const outputRelative = path.relative(rootReal, outputParentReal);
      if (!outputRelative || outputRelative.startsWith("..") || path.isAbsolute(outputRelative)) {
        throw new Error(`Subtitle output escapes Clippers workspace: ${output}`);
      }
      const outputStats = await lstat(output).catch(() => null);
      if (outputStats?.isSymbolicLink()) throw new Error(`Subtitle output cannot be a symlink: ${output}`);
      const existing = await stat(output).catch(() => null);
      if (existing?.size > 0 && !force) {
        results.push({ campaignId: decision.campaignId, slot: assignment.slot, status: "existing", output, apiCostUsd: 0 });
        continue;
      }
      const rendered = await renderLocalSubtitles({ input, output, model, mode: assignment.subtitleStyle });
      results.push({ campaignId: decision.campaignId, slot: assignment.slot, status: "rendered", ...rendered });
    }
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    totalAssignments: results.length,
    rendered: results.filter((row) => row.status === "rendered").length,
    existing: results.filter((row) => row.status === "existing").length,
    hookOnly: results.filter((row) => row.status === "hook_only_no_transcript").length,
    blocked: results.filter((row) => row.status === "skipped_blocked_campaign").length,
    apiCostUsd: 0,
    realPublishEnabled: false,
    metricoolApprovalRequired: true,
    results,
  };
  await writeFile(path.join(root, "reports", "streamer-subtitle-batch.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function cliArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const input = cliArg("input");
  const output = cliArg("output");
  const workspaceRoot = path.resolve(process.env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
  const model = cliArg("model") || path.join(workspaceRoot, "models", "ggml-base.en.bin");
  const mode = cliArg("mode") || "clean_sentence";
  if (process.argv.includes("--batch")) {
    console.log(JSON.stringify(await renderAssignedBatch({ workspaceRoot, model, force: process.argv.includes("--force") }), null, 2));
    return;
  }
  if (!input || !output) throw new Error("Usage: --input <video.mp4> --output <video.mp4> [--mode clean_sentence|word_by_word] OR --batch");
  console.log(JSON.stringify(await renderLocalSubtitles({ input, output, model, mode }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
