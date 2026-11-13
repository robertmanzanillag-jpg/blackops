import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const sourceDropDir = path.join(rootDir, "source-drop");
const renderedDir = path.join(rootDir, "rendered", "owned-gap-frames");
const forceRender = process.argv.includes("--force-render");
const commandTimeoutMs = 5 * 60_000;

const specs = [
  ...[
    ["sports", "sports-owned-33.mp4", "Replay without replay", "explain the decision", "no footage needed"],
    ["sports", "sports-owned-34.mp4", "One possession swing", "spacing tells it", "score follows"],
    ["sports", "sports-owned-35.mp4", "The quiet adjustment", "same set", "better angle"],
    ["sports", "sports-owned-36.mp4", "Final whistle lesson", "clock pressure", "clean read"],
    ["sports", "sports-owned-37.mp4", "Film note fast", "help defense moves", "lane opens"],
    ["sports", "sports-owned-38.mp4", "Underrated timeout", "stop the run", "reset the floor"],
    ["sports", "sports-owned-39.mp4", "Box score lie", "watch possession", "not points"],
    ["sports", "sports-owned-40.mp4", "Momentum checkpoint", "three stops", "one run"],
    ["sports", "sports-owned-41.mp4", "Smart foul math", "risk or reset", "clock decides"],
    ["sports", "sports-owned-42.mp4", "Clutch spacing", "one step wider", "shot is cleaner"],
  ],
  ...[
    ["memes", "memes-owned-31.mp4", "When the dashboard says ready", "but still asks for proof", "responsible growth"],
    ["memes", "memes-owned-32.mp4", "POV: 100 clips/week", "and every file has receipts", "finally calm"],
    ["memes", "memes-owned-33.mp4", "The source folder after cleanup", "no missing evidence", "beautiful"],
    ["memes", "memes-owned-34.mp4", "Metricool queue waiting", "approval mode only", "as it should"],
    ["memes", "memes-owned-35.mp4", "When owned assets carry", "and rights stays boring", "perfect"],
  ],
  ...[
    ["streamers", "streamers-owned-21.mp4", "No raw clip recap", "context first", "owned visual only"],
    ["streamers", "streamers-owned-22.mp4", "Chat theory format", "what happened", "why it mattered"],
    ["streamers", "streamers-owned-23.mp4", "Streamer moment explained", "no repost", "clean commentary"],
  ],
].map(([category, fileName, title, line1, line2], index) => ({ category, fileName, title, line1, line2, index }));

const palettes = {
  sports: [["0x10231f", "0x34d399"], ["0x171f33", "0x60a5fa"], ["0x241b12", "0xfbbf24"]],
  memes: [["0x1f2937", "0xf472b6"], ["0x12262b", "0x67e8f9"], ["0x2a2117", "0xfacc15"]],
  streamers: [["0x211733", "0xc084fc"], ["0x12202a", "0x22d3ee"], ["0x2b1720", "0xfb7185"]],
};

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function killCommandProcess(child) {
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall back to killing only the direct child when process groups are unavailable.
    }
  }
  child.kill("SIGKILL");
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      killCommandProcess(child);
      reject(new Error(`${command} timed out after ${commandTimeoutMs}ms`));
    }, commandTimeoutMs);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("exit", (code) => {
      finish(() => {
        if (code === 0) resolve();
        else reject(new Error(`${command} failed with code ${code}${stderr ? `\n${stderr}` : ""}`));
      });
    });
  });
}

async function fileExists(filePath) {
  return stat(filePath).then((file) => file.isFile()).catch(() => false);
}

async function renderSource(spec) {
  const categoryDir = path.join(sourceDropDir, spec.category);
  const frameDir = path.join(renderedDir, spec.category);
  await mkdir(categoryDir, { recursive: true });
  await mkdir(frameDir, { recursive: true });
  const outputPath = path.join(categoryDir, spec.fileName);
  const framePath = path.join(frameDir, `${path.basename(spec.fileName, ".mp4")}.png`);
  if (!forceRender && await fileExists(outputPath) && await fileExists(framePath)) return false;
  const [bg, accent] = palettes[spec.category][spec.index % palettes[spec.category].length];
  await runCommand("convert", [
    "-size", "1080x1920",
    `xc:${bg.replace("0x", "#")}`,
    "-fill", accent.replace("0x", "#"),
    "-draw", "rectangle 70,100 1010,1820",
    "-fill", "rgba(0,0,0,0.45)",
    "-draw", "rectangle 120,420 960,1180",
    "-gravity", "center",
    "-fill", "white",
    "-pointsize", "64",
    "-annotate", "+0-265", spec.line1,
    "-fill", accent.replace("0x", "#"),
    "-pointsize", "60",
    "-annotate", "+0-80", spec.line2,
    "-fill", "rgba(255,255,255,0.82)",
    "-pointsize", "36",
    "-annotate", "+0+260", spec.title,
    "-fill", "rgba(255,255,255,0.68)",
    "-pointsize", "30",
    "-annotate", "+0+655", "ORIGINAL OWNED SOURCE",
    framePath,
  ]);
  await runCommand("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", framePath,
    "-t", "6",
    "-r", "30",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ]);
  return true;
}

async function writeEvidence(category, categorySpecs) {
  const categoryDir = path.join(sourceDropDir, category);
  await mkdir(categoryDir, { recursive: true });
  const evidencePath = path.join(categoryDir, "owned-gap-production-notes.md");
  const label = category === "sports" ? "Sports Daily" : category === "memes" ? "Meme Radar" : "Streamer Pulse";
  const restriction = category === "sports"
    ? "No league footage, broadcast footage, team footage, athlete likenesses, copyrighted music, scraped highlights, third-party footage, or platform-private material are included."
    : category === "streamers"
      ? "No raw streamer clips, creator likenesses, copyrighted music, cookies, tokens, passwords, private screenshots, scraped footage, or platform-private material are included."
      : "No third-party footage, creator clips, sports broadcasts, streamer clips, licensed music, watermarked reposts, cookies, tokens, passwords, private screenshots, or platform-private material are included.";
  if (!forceRender && await fileExists(evidencePath)) return evidencePath;
  await writeFile(evidencePath, [
    `# Owned Gap Source Production Notes - ${label}`,
    "",
    "status: owned_source",
    `category: ${category}`,
    "created_by: local Clippers gap generation script",
    `created_at: ${new Date().toISOString()}`,
    "",
    `These ${categorySpecs.length} source videos are original generated vertical assets for ${label}.`,
    restriction,
    "They are approved only as owned source inputs for draft creation and Metricool approval_required queue review.",
    "",
    "Covered files:",
    ...categorySpecs.map((spec) => `- ${spec.fileName}`),
    "",
  ].join("\n"));
  return evidencePath;
}

async function appendManifest(category, categorySpecs, evidencePath) {
  const manifestPath = path.join(sourceDropDir, category, "source-drop-manifest.csv");
  const header = "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes";
  const current = await readFile(manifestPath, "utf8").catch(() => `${header}\n`);
  const rows = categorySpecs
    .filter((spec) => !current.includes(spec.fileName))
    .map((spec) => [
      category,
      spec.title,
      `owned-source://gap/${category}/${spec.fileName}`,
      `${category} original generated gap asset`,
      "tiktok",
      spec.fileName,
      "owned_or_permissioned",
      `owner note path: ${evidencePath}`,
      "high",
      "Original generated owned source. No third-party footage or copyrighted music. Use approval_required queue.",
    ].map(csvCell).join(","));
  if (!rows.length) return 0;
  await writeFile(manifestPath, `${current.trimEnd() || header}\n${rows.join("\n")}\n`);
  return rows.length;
}

async function main() {
  let rendered = 0;
  for (const spec of specs) {
    if (await renderSource(spec)) rendered += 1;
  }
  let appended = 0;
  for (const category of ["sports", "memes", "streamers"]) {
    const categorySpecs = specs.filter((spec) => spec.category === category);
    const evidencePath = await writeEvidence(category, categorySpecs);
    appended += await appendManifest(category, categorySpecs, evidencePath);
  }
  console.log(JSON.stringify({
    generated: specs.length,
    rendered,
    appendedManifestRows: appended,
    forceRender,
    sports: specs.filter((spec) => spec.category === "sports").length,
    memes: specs.filter((spec) => spec.category === "memes").length,
    streamers: specs.filter((spec) => spec.category === "streamers").length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
