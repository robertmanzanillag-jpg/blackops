import { mkdir, readFile, writeFile } from "fs/promises";
import { spawn } from "child_process";
import path from "path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const renderedDir = path.join(rootDir, "rendered", "owned-sports-streamer-frames");
const commandTimeoutMs = 5 * 60_000;

type SourceCategory = "sports" | "streamers";

interface OwnedSourceSpec {
  category: SourceCategory;
  fileName: string;
  title: string;
  line1: string;
  line2: string;
  label: string;
  palette: [string, string, string];
}

const specs: OwnedSourceSpec[] = [
  ...[
    ["sports-owned-01.mp4", "Last minute pressure", "3 seconds left", "one smart pass wins"],
    ["sports-owned-02.mp4", "Underdog comeback", "down big early", "momentum flips fast"],
    ["sports-owned-03.mp4", "Why the timeout mattered", "coach saw the mismatch", "the next play changed"],
    ["sports-owned-04.mp4", "Defensive trap explained", "two steps too late", "easy steal incoming"],
    ["sports-owned-05.mp4", "The stat nobody noticed", "rebounds told the story", "before the score did"],
    ["sports-owned-06.mp4", "Rookie mistake breakdown", "good idea", "wrong angle"],
    ["sports-owned-07.mp4", "Momentum swing", "crowd gets loud", "the defense speeds up"],
    ["sports-owned-08.mp4", "Clutch decision", "take the shot?", "or burn the clock?"],
    ["sports-owned-09.mp4", "Film room in 8 seconds", "watch the weak side", "that is the whole play"],
    ["sports-owned-10.mp4", "Ranking the chaos", "bad bounce", "perfect reaction"],
    ["sports-owned-11.mp4", "What changed after halftime", "same players", "new spacing"],
  ].map(([fileName, title, line1, line2], index): OwnedSourceSpec => ({
    category: "sports",
    fileName,
    title,
    line1,
    line2,
    label: "Sports Daily original analysis",
    palette: [
      ["#10231f", "#34d399", "#f8fafc"],
      ["#171f33", "#60a5fa", "#f8fafc"],
      ["#241b12", "#fbbf24", "#ffffff"],
    ][index % 3] as [string, string, string],
  })),
  ...[
    ["streamers-owned-01.mp4", "Chat reaction format", "chat saw it first", "creator missed it"],
    ["streamers-owned-02.mp4", "The pause before chaos", "one silent second", "then everything breaks"],
    ["streamers-owned-03.mp4", "Streamer story recap", "setup was normal", "payoff was not"],
    ["streamers-owned-04.mp4", "Clip without raw footage", "explain the moment", "use owned graphics"],
    ["streamers-owned-05.mp4", "Drama recap structure", "claim", "context", "receipt check"],
    ["streamers-owned-06.mp4", "Speedrun fail pattern", "one clean input", "one costly panic"],
    ["streamers-owned-07.mp4", "Chat poll hook", "would you risk it?", "yes or no"],
    ["streamers-owned-08.mp4", "Reaction loop", "watch the counter", "then watch it again"],
    ["streamers-owned-09.mp4", "No raw clip needed", "tell the story", "keep it original"],
  ].map(([fileName, title, line1, line2], index): OwnedSourceSpec => ({
    category: "streamers",
    fileName,
    title,
    line1,
    line2,
    label: "Streamer Pulse original commentary",
    palette: [
      ["#201733", "#c084fc", "#f8fafc"],
      ["#12202a", "#22d3ee", "#f8fafc"],
      ["#2b1720", "#fb7185", "#ffffff"],
    ][index % 3] as [string, string, string],
  })),
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

async function renderOwnedSource(spec: OwnedSourceSpec, index: number): Promise<void> {
  const dropDir = path.join(rootDir, "source-drop", spec.category);
  const frameDir = path.join(renderedDir, spec.category);
  await mkdir(dropDir, { recursive: true });
  await mkdir(frameDir, { recursive: true });

  const outputPath = path.join(dropDir, spec.fileName);
  const framePath = path.join(frameDir, `${path.basename(spec.fileName, ".mp4")}.png`);
  const [bg, accent, fg] = spec.palette;

  await runCommand("convert", [
    "-size", "1080x1920",
    `xc:${bg}`,
    "-fill", accent,
    "-draw", "rectangle 68,96 1012,1824",
    "-fill", "rgba(0,0,0,0.46)",
    "-draw", "rectangle 118,430 962,1085",
    "-fill", "rgba(255,255,255,0.12)",
    "-draw", "rectangle 166,1170 914,1320",
    "-gravity", "center",
    "-fill", fg,
    "-pointsize", "74",
    "-annotate", "+0-310", spec.line1,
    "-fill", accent,
    "-pointsize", "68",
    "-annotate", "+0-95", spec.line2,
    "-fill", "rgba(255,255,255,0.82)",
    "-pointsize", "38",
    "-annotate", "+0+250", spec.title,
    "-fill", "rgba(255,255,255,0.70)",
    "-pointsize", "32",
    "-annotate", "+0+650", "ORIGINAL OWNED SOURCE",
    "-fill", "rgba(255,255,255,0.58)",
    "-pointsize", "29",
    "-annotate", "+0+705", spec.label,
    framePath,
  ]);

  await runCommand("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", framePath,
    "-t", String(index % 2 === 0 ? 7 : 6),
    "-r", "30",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ]);
}

async function writeCategoryArtifacts(category: SourceCategory, categorySpecs: OwnedSourceSpec[]) {
  const dropDir = path.join(rootDir, "source-drop", category);
  const evidencePath = path.join(dropDir, `owned-${category}-production-notes.md`);
  const manifestPath = path.join(dropDir, "source-drop-manifest.csv");
  const label = category === "sports" ? "Sports Daily" : "Streamer Pulse";

  await mkdir(dropDir, { recursive: true });
  await writeFile(evidencePath, [
    `# Owned ${category === "sports" ? "Sports" : "Streamer"} Source Production Notes`,
    "",
    "status: owned_source",
    `category: ${category}`,
    "created_by: local Clippers generation script",
    `created_at: ${new Date().toISOString()}`,
    "",
    `These source videos are original generated assets created locally for ${label}.`,
    category === "sports"
      ? "They use original text/graphic analysis only; no league footage, broadcast footage, team footage, athlete likenesses, copyrighted music, or scraped highlights are included."
      : "They use original text/graphic commentary only; no streamer raw clips, creator likenesses, copyrighted music, cookies, tokens, passwords, or private screenshots are included.",
    "They are approved only as owned source inputs for draft creation and Metricool approval queue review.",
    "",
    "Guardrails:",
    "- Keep Metricool in approval_required mode.",
    "- Review captions before posting.",
    "- Do not imply official league, team, creator, or streamer endorsement.",
    "- Replace any asset if a future platform policy or brand review rejects the format.",
    "",
  ].join("\n"));

  const header = "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes";
  const currentManifest = await readFile(manifestPath, "utf8").catch(() => `${header}\n`);
  const existingFileNames = new Set(categorySpecs.filter((spec) => currentManifest.includes(spec.fileName)).map((spec) => spec.fileName));
  const rows = categorySpecs
    .filter((spec) => !existingFileNames.has(spec.fileName))
    .map((spec, index) => [
      category,
      spec.title,
      `owned-source://${label.toLowerCase().replace(/\s+/g, "-")}/${spec.fileName}`,
      `${label} original generated asset`,
      "tiktok",
      spec.fileName,
      "owned_or_permissioned",
      `owner note path: ${evidencePath}`,
      index < 8 ? "high" : "medium",
      category === "sports"
        ? "Original generated sports analysis graphic. No third-party footage, broadcast clips, likeness use, or copyrighted music. Use approval_required queue."
        : "Original generated streamer commentary graphic. No raw streamer clip, creator likeness, third-party footage, or copyrighted music. Use approval_required queue.",
    ].map(csvCell).join(","));
  if (rows.length) {
    const base = currentManifest.trim() ? currentManifest.trimEnd() : header;
    await writeFile(manifestPath, `${base}\n${rows.join("\n")}\n`);
  }
}

async function main() {
  await mkdir(renderedDir, { recursive: true });
  for (let index = 0; index < specs.length; index += 1) {
    await renderOwnedSource(specs[index], index);
  }

  await writeCategoryArtifacts("sports", specs.filter((spec) => spec.category === "sports"));
  await writeCategoryArtifacts("streamers", specs.filter((spec) => spec.category === "streamers"));

  console.log("Generated owned sports and streamer source videos.");
  console.log(`Sports: ${specs.filter((spec) => spec.category === "sports").length}`);
  console.log(`Streamers: ${specs.filter((spec) => spec.category === "streamers").length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
