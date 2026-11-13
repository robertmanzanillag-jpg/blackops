import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(process.env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
const sourceDir = path.join(workspaceRoot, "source-drop", "streamers");
const outputDir = path.join(workspaceRoot, "drafts", "vyro", "mrbeast-jre-2026-07-21");

const clips = [
  ["mrbeast-jre-vyro-01-largest-cash-prize.mp4", "MRBEAST'S BIGGEST\nCASH PRIZE"],
  ["mrbeast-jre-vyro-02-vr-addiction.mp4", "THE REAL RISK OF\nVR ADDICTION"],
  ["mrbeast-jre-vyro-03-food-waste.mp4", "WHY SO MUCH FOOD\nGETS WASTED"],
  ["mrbeast-jre-vyro-04-tv-standards.mp4", "WHY MRBEAST GOES\nBEYOND TV"],
  ["mrbeast-jre-vyro-05-ending-child-labor.mp4", "MRBEAST ON ENDING\nCHILD LABOR"],
  ["mrbeast-jre-vyro-06-be-your-own-boss.mp4", "WHY HE CHOSE TO BE\nHIS OWN BOSS"],
  ["mrbeast-jre-vyro-07-egyptian-pyramids.mp4", "WHAT LIVING IN A\nPYRAMID WAS LIKE"],
];
const requestedClip = Number(process.argv.find((arg) => arg.startsWith("--clip="))?.split("=")[1] || 0);
const manifestOnly = process.argv.includes("--manifest-only");
const selectedClips = manifestOnly ? [] : requestedClip > 0 ? clips.slice(requestedClip - 1, requestedClip) : clips;
if (!manifestOnly && !selectedClips.length) throw new Error(`Unknown clip number: ${requestedClip}`);

function outputName(sourceName) {
  return sourceName.replace("mrbeast-jre-vyro-", "streamersclipusa-mrbeast-jre-");
}

async function renderClip(sourceName, hook) {
  const sourcePath = path.join(sourceDir, sourceName);
  const targetPath = path.join(outputDir, outputName(sourceName));
  const titlePath = path.join(outputDir, `${path.parse(sourceName).name}-hook.png`);

  await execFileAsync("magick", [
    "-size", "540x180",
    "xc:#00000099",
    "-gravity", "center",
    "-font", "Arial-Bold",
    "-pointsize", "38",
    "-fill", "white",
    "-stroke", "black",
    "-strokewidth", "2",
    "-annotate", "+0+0", hook,
    titlePath,
  ]);

  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", sourcePath,
    "-i", titlePath,
    "-filter_complex",
    "[0:v]crop=606:1080:(iw-606)/2:0[base];[base][1:v]overlay=(W-w)/2:70:eof_action=repeat[v]",
    "-map", "[v]", "-map", "0:a:0",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
    "-c:a", "aac", "-b:a", "192k",
    "-shortest",
    "-movflags", "+faststart",
    "-metadata", "comment=Vyro MrBeast x Joe Rogan campaign-scoped draft; approval required",
    targetPath,
  ]);

  return { sourceName, hook, targetPath };
}

async function outputIsValid(targetPath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=codec_name,width,height:format=duration",
      "-of", "json",
      targetPath,
    ]);
    const probe = JSON.parse(stdout);
    const video = probe.streams?.find((stream) => stream.codec_name === "h264");
    return Boolean(video?.width === 606 && video?.height === 1080 && Number(probe.format?.duration) > 10);
  } catch {
    return false;
  }
}

const evidencePath = path.join(workspaceRoot, "evidence-drop", "vyro", "mrbeast-jre-campaign-2026-07-21.md");
const evidence = await readFile(evidencePath, "utf8");
if (!evidence.includes("Successfully joined the campaign!")) {
  throw new Error("Campaign join evidence is missing; drafts remain blocked.");
}

await mkdir(outputDir, { recursive: true });
const rendered = [];
for (const [sourceName, hook] of selectedClips) rendered.push(await renderClip(sourceName, hook));

const manifestClips = clips.map(([sourceName, hook]) => ({ sourceName, hook, targetPath: path.join(outputDir, outputName(sourceName)) }));
const outputChecks = await Promise.all(manifestClips.map(async (clip) => ({ sourceName: clip.sourceName, valid: await outputIsValid(clip.targetPath) })));
const invalidOutputs = outputChecks.filter((check) => !check.valid).map((check) => check.sourceName);

const manifest = {
  status: invalidOutputs.length ? "drafts_incomplete" : "drafts_ready_for_qa",
  generatedAt: new Date().toISOString(),
  campaignId: "mrbeast-x-joe-rogan-jp803TnR",
  account: "streamersclipusa",
  publisher: "metricool",
  metricoolApprovalRequired: true,
  realPublishEnabled: false,
  requiredCaptionHashtags: ["#MrBeast", "#paidpartner"],
  sourceEvidencePath: evidencePath,
  cleanupPolicy: {
    mode: "delete_after_verified_publish_and_vyro_submission",
    command: "node script/clippers-cleanup-published-vyro-media.mjs --execute",
    requiredProof: ["exact TikTok post URL", "Metricool published status", "Vyro submitted status", "published timestamp"],
    retainedEvidence: ["campaign evidence", "draft manifest", "cleanup ledger with SHA-256 hashes"],
  },
  clips: manifestClips,
  outputChecks,
  blockers: [
    ...(invalidOutputs.length ? [`Missing or invalid draft outputs: ${invalidOutputs.join(", ")}`] : []),
    "Visual and audio QA is required before Metricool approval.",
    "Metricool account routing must be confirmed for streamersclipusa.",
    "Vyro payout identity and payout method must be completed by the account owner.",
    "Submit each public TikTok URL to Vyro immediately after publishing.",
  ],
};
await writeFile(path.join(outputDir, "draft-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
