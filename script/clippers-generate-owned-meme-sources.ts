import { mkdir, readFile, writeFile } from "fs/promises";
import { spawn } from "child_process";
import path from "path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const dropDir = path.join(rootDir, "source-drop", "memes");
const framesDir = path.join(rootDir, "rendered", "owned-meme-frames");
const evidencePath = path.join(dropDir, "owned-meme-production-notes.md");
const manifestPath = path.join(dropDir, "source-drop-manifest.csv");
const commandTimeoutMs = 5 * 60_000;

const memes = [
  ["memes-owned-01.mp4", "POV: you opened the app", "and it already found the problem"],
  ["memes-owned-02.mp4", "When the plan says quick task", "but the checklist has 47 steps"],
  ["memes-owned-03.mp4", "Me checking the dashboard", "after changing one tiny setting"],
  ["memes-owned-04.mp4", "The clipper agent at 2AM", "still asking for proof"],
  ["memes-owned-05.mp4", "When the source is viral", "but the rights gate says nope"],
  ["memes-owned-06.mp4", "POV: the queue is empty", "because quality control did its job"],
  ["memes-owned-07.mp4", "The metric says ready", "the audit says not so fast"],
  ["memes-owned-08.mp4", "When the file is called mp4", "but it is secretly text"],
  ["memes-owned-09.mp4", "The safest growth hack", "is not getting banned"],
  ["memes-owned-10.mp4", "Me after fixing one blocker", "and discovering the real blocker"],
  ["memes-owned-11.mp4", "When the report says blocked", "but at least it is honest"],
  ["memes-owned-12.mp4", "Creator permission found", "instant dashboard serotonin"],
  ["memes-owned-13.mp4", "The content calendar", "when every asset has proof"],
  ["memes-owned-14.mp4", "POV: approval queue only", "because autopost needs receipts"],
];

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function killCommandProcess(child: ReturnType<typeof spawn>): void {
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

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: ["ignore", "inherit", "pipe"] });
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
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
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("exit", (code) => {
      finish(() => {
        if (code === 0) resolve();
        else reject(new Error(`${command} failed with code ${code}${stderr ? `\n${stderr}` : ""}`));
      });
    });
  });
}

async function runFfmpeg(outputPath: string, line1: string, line2: string, index: number): Promise<void> {
  const palettes = [
    ["0x18202b", "0x6ee7b7"],
    ["0x231b33", "0xf9a8d4"],
    ["0x11262b", "0x67e8f9"],
    ["0x2a2117", "0xfacc15"],
    ["0x1f2937", "0xa7f3d0"],
    ["0x2b1d25", "0xfda4af"],
    ["0x172033", "0x93c5fd"],
  ];
  const [bg, accent] = palettes[index % palettes.length];
  const normalizeHex = (value: string) => `#${value.replace("0x", "")}`;
  const framePath = path.join(framesDir, `${path.basename(outputPath, ".mp4")}.png`);

  await runCommand("convert", [
    "-size", "1080x1920",
    `xc:${normalizeHex(bg)}`,
    "-fill", normalizeHex(accent),
    "-draw", "rectangle 70,110 1010,1810",
    "-fill", "rgba(0,0,0,0.42)",
    "-draw", "rectangle 110,500 970,980",
    "-gravity", "center",
    "-fill", "white",
    "-pointsize", "78",
    "-annotate", "+0-250", line1,
    "-fill", normalizeHex(accent),
    "-pointsize", "68",
    "-annotate", "+0-55", line2,
    "-fill", "rgba(255,255,255,0.78)",
    "-pointsize", "34",
    "-annotate", "+0+650", "ORIGINAL OWNED SOURCE",
    "-fill", "rgba(255,255,255,0.58)",
    "-pointsize", "30",
    "-annotate", "+0+705", "Meme Radar",
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
}

async function main() {
  await mkdir(dropDir, { recursive: true });
  await mkdir(framesDir, { recursive: true });
  await writeFile(evidencePath, [
    "# Owned Meme Source Production Notes",
    "",
    "status: owned_source",
    "category: memes",
    "created_by: local Clippers generation script",
    `created_at: ${new Date().toISOString()}`,
    "",
    "These source videos are original generated assets created locally for Meme Radar.",
    "They do not use third-party footage, creator clips, sports broadcasts, streamer clips, licensed music, cookies, tokens, passwords, or private screenshots.",
    "They are approved only as owned source inputs for draft creation and Metricool approval queue review.",
    "",
    "Guardrails:",
    "- Keep approval_required publishing mode.",
    "- Review captions before posting.",
    "- Replace any asset if a future platform policy or brand review rejects the format.",
    "",
  ].join("\n"));

  const header = "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes";
  const currentManifest = await readFile(manifestPath, "utf8").catch(() => `${header}\n`);
  const existingFileNames = new Set(currentManifest.split(/\r?\n/).filter(Boolean).flatMap((line) =>
    memes.map(([fileName]) => fileName).filter((fileName) => line.includes(fileName))
  ));
  const rows = memes
    .filter(([fileName]) => !existingFileNames.has(fileName))
    .map(([fileName, line1, line2], index) => [
      "memes",
      `${line1} / ${line2}`,
      `owned-source://meme-radar/${fileName}`,
      "Meme Radar original generated asset",
      "tiktok",
      fileName,
      "owned_or_permissioned",
      `owner note path: ${evidencePath}`,
      index < 10 ? "high" : "medium",
      "Original generated vertical meme source. No third-party footage or copyrighted music. Use approval_required queue.",
    ].map(csvCell).join(","));
  if (rows.length) {
    const base = currentManifest.trim() ? currentManifest.trimEnd() : header;
    await writeFile(manifestPath, `${base}\n${rows.join("\n")}\n`);
  }

  for (let index = 0; index < memes.length; index += 1) {
    const [fileName, line1, line2] = memes[index];
    await runFfmpeg(path.join(dropDir, fileName), line1, line2, index + 1);
  }

  console.log(`Generated ${memes.length} owned meme source videos in ${dropDir}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Evidence: ${evidencePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
