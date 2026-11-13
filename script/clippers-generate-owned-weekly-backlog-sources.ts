import { mkdir, readFile, writeFile } from "fs/promises";
import { spawn } from "child_process";
import path from "path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const sourceDropDir = path.join(rootDir, "source-drop");
const renderedDir = path.join(rootDir, "rendered", "owned-weekly-backlog-frames");
const commandTimeoutMs = 5 * 60_000;

type SourceCategory = "sports" | "memes" | "streamers";

interface OwnedBacklogSpec {
  category: SourceCategory;
  fileName: string;
  title: string;
  hook: string;
  payoff: string;
  label: string;
  palette: [string, string, string, string];
}

const sportsHooks = [
  ["sports-owned-12.mp4", "Film room: spacing", "one step wider", "whole defense moves"],
  ["sports-owned-13.mp4", "Clutch clock check", "two options left", "pick the quiet one"],
  ["sports-owned-14.mp4", "Why the run started", "first stop matters", "then confidence stacks"],
  ["sports-owned-15.mp4", "Pressure possession", "no hero ball", "just the right read"],
  ["sports-owned-16.mp4", "Bench energy swing", "one hustle play", "changed the quarter"],
  ["sports-owned-17.mp4", "Mismatch alert", "small delay", "big opening"],
  ["sports-owned-18.mp4", "Turnover lesson", "rushed pass", "easy points the other way"],
  ["sports-owned-19.mp4", "Late game math", "foul or defend?", "the clock decides"],
  ["sports-owned-20.mp4", "Momentum map", "three stops", "one clean run"],
  ["sports-owned-21.mp4", "Shot selection check", "open is not always best", "balance matters"],
  ["sports-owned-22.mp4", "Coach adjustment", "same set", "new angle"],
  ["sports-owned-23.mp4", "Defense reads first", "watch the help", "then the steal"],
  ["sports-owned-24.mp4", "Fast break choice", "finish or kick", "depends on the trailer"],
  ["sports-owned-25.mp4", "Box score trap", "points lied", "possessions told it"],
  ["sports-owned-26.mp4", "Final minute lens", "no panic", "clean execution"],
  ["sports-owned-27.mp4", "Underrated assist", "pass before the pass", "that made the highlight"],
  ["sports-owned-28.mp4", "Rebound battle", "position first", "jump second"],
  ["sports-owned-29.mp4", "Timeout value", "stop the run", "reset the matchup"],
  ["sports-owned-30.mp4", "One play breakdown", "screen angle", "open lane"],
  ["sports-owned-31.mp4", "Crowd swing moment", "noise rises", "pace changes"],
  ["sports-owned-32.mp4", "Smart foul debate", "risk the whistle", "or guard straight up"],
];

const memeHooks = [
  ["memes-owned-15.mp4", "POV: the dashboard is honest", "and your ego was not ready"],
  ["memes-owned-16.mp4", "When the queue says no", "but saves the account"],
  ["memes-owned-17.mp4", "Me chasing 1M views", "with 12 approval gates"],
  ["memes-owned-18.mp4", "The viral idea is perfect", "until rights enters the chat"],
  ["memes-owned-19.mp4", "When the file finally renders", "and the test also passes"],
  ["memes-owned-20.mp4", "POV: source proof exists", "instant calm"],
  ["memes-owned-21.mp4", "Me opening Metricool", "approval mode only"],
  ["memes-owned-22.mp4", "When the scout finds heat", "but the URL is just search"],
  ["memes-owned-23.mp4", "The safe version wins", "because it survives review"],
  ["memes-owned-24.mp4", "When one clip becomes ten", "because the format is owned"],
  ["memes-owned-25.mp4", "POV: no watermark", "no drama"],
  ["memes-owned-26.mp4", "The content machine", "asking for receipts again"],
  ["memes-owned-27.mp4", "When blocked means protected", "not delayed"],
  ["memes-owned-28.mp4", "The weekly target staring", "at the source folder"],
  ["memes-owned-29.mp4", "Me after importing source-drop", "suddenly productive"],
  ["memes-owned-30.mp4", "When the app says behind", "so we make more assets"],
];

const streamerHooks = [
  ["streamers-owned-10.mp4", "No raw clip recap", "tell the moment", "keep it original"],
  ["streamers-owned-11.mp4", "Chat missed detail", "tiny pause", "huge context"],
  ["streamers-owned-12.mp4", "Stream story format", "setup", "twist", "takeaway"],
  ["streamers-owned-13.mp4", "Reaction without footage", "caption the beat", "own the asset"],
  ["streamers-owned-14.mp4", "Creator drama filter", "claim first", "proof second"],
  ["streamers-owned-15.mp4", "Speedrun tension", "clean path", "one risky input"],
  ["streamers-owned-16.mp4", "Chat poll moment", "would you press it?", "comments decide"],
  ["streamers-owned-17.mp4", "Clip idea remake", "same structure", "new owned visual"],
  ["streamers-owned-18.mp4", "Streamer recap hook", "what happened", "why it mattered"],
  ["streamers-owned-19.mp4", "Loopable reaction beat", "pause", "caption", "repeat"],
  ["streamers-owned-20.mp4", "Context over repost", "explain fast", "avoid raw footage"],
];

const palettes: Record<SourceCategory, [string, string, string, string][]> = {
  sports: [
    ["#0f1f2a", "#22c55e", "#f8fafc", "#071016"],
    ["#141f34", "#38bdf8", "#f8fafc", "#09111f"],
    ["#251b12", "#f59e0b", "#ffffff", "#120b05"],
    ["#13251d", "#a3e635", "#f8fafc", "#08120d"],
  ],
  memes: [
    ["#1f2937", "#f472b6", "#ffffff", "#101827"],
    ["#172033", "#93c5fd", "#f8fafc", "#080d18"],
    ["#12262b", "#67e8f9", "#f8fafc", "#071519"],
    ["#2a2117", "#facc15", "#ffffff", "#151008"],
  ],
  streamers: [
    ["#211733", "#c084fc", "#f8fafc", "#10091c"],
    ["#12202a", "#22d3ee", "#f8fafc", "#071117"],
    ["#2b1720", "#fb7185", "#ffffff", "#16080e"],
    ["#182217", "#86efac", "#f8fafc", "#0a1108"],
  ],
};

const specs: OwnedBacklogSpec[] = [
  ...sportsHooks.map((row, index) => makeSpec("sports", row, index)),
  ...memeHooks.map((row, index) => makeSpec("memes", row, index)),
  ...streamerHooks.map((row, index) => makeSpec("streamers", row, index)),
];

function makeSpec(category: SourceCategory, [fileName, title, hook, payoff]: string[], index: number): OwnedBacklogSpec {
  const label = category === "sports"
    ? "Sports Daily original analysis"
    : category === "memes"
      ? "Meme Radar original format"
      : "Streamer Pulse original commentary";
  return {
    category,
    fileName,
    title,
    hook,
    payoff,
    label,
    palette: palettes[category][index % palettes[category].length],
  };
}

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

async function renderSource(spec: OwnedBacklogSpec, index: number): Promise<void> {
  const categoryDropDir = path.join(sourceDropDir, spec.category);
  const frameDir = path.join(renderedDir, spec.category);
  await mkdir(categoryDropDir, { recursive: true });
  await mkdir(frameDir, { recursive: true });

  const outputPath = path.join(categoryDropDir, spec.fileName);
  const framePath = path.join(frameDir, `${path.basename(spec.fileName, ".mp4")}.png`);
  const [bg, accent, fg, panel] = spec.palette;

  await runCommand("convert", [
    "-size", "1080x1920",
    `xc:${bg}`,
    "-fill", accent,
    "-draw", "rectangle 68,90 1012,1830",
    "-fill", panel,
    "-draw", "rectangle 118,390 962,1120",
    "-fill", "rgba(255,255,255,0.12)",
    "-draw", "rectangle 166,1190 914,1345",
    "-gravity", "center",
    "-fill", fg,
    "-pointsize", "70",
    "-annotate", "+0-335", spec.hook,
    "-fill", accent,
    "-pointsize", "64",
    "-annotate", "+0-105", spec.payoff,
    "-fill", "rgba(255,255,255,0.84)",
    "-pointsize", "36",
    "-annotate", "+0+260", spec.title,
    "-fill", "rgba(255,255,255,0.72)",
    "-pointsize", "31",
    "-annotate", "+0+650", "ORIGINAL OWNED SOURCE",
    "-fill", "rgba(255,255,255,0.58)",
    "-pointsize", "28",
    "-annotate", "+0+704", spec.label,
    framePath,
  ]);

  await runCommand("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", framePath,
    "-t", String(index % 3 === 0 ? 7 : 6),
    "-r", "30",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ]);
}

async function writeEvidence(category: SourceCategory, categorySpecs: OwnedBacklogSpec[]): Promise<string> {
  const categoryDropDir = path.join(sourceDropDir, category);
  await mkdir(categoryDropDir, { recursive: true });
  const evidencePath = path.join(categoryDropDir, "owned-weekly-backlog-production-notes.md");
  const label = category === "sports" ? "Sports Daily" : category === "memes" ? "Meme Radar" : "Streamer Pulse";
  const restriction = category === "sports"
    ? "No league footage, broadcast footage, team footage, athlete likenesses, copyrighted music, or scraped highlights are included."
    : category === "streamers"
      ? "No streamer raw clips, creator likenesses, copyrighted music, cookies, tokens, passwords, private screenshots, or scraped footage are included."
      : "No third-party footage, creator clips, sports broadcasts, streamer clips, licensed music, cookies, tokens, passwords, or private screenshots are included.";

  await writeFile(evidencePath, [
    `# Owned Weekly Backlog Production Notes - ${label}`,
    "",
    "status: owned_source",
    `category: ${category}`,
    "created_by: local Clippers backlog generation script",
    `created_at: ${new Date().toISOString()}`,
    "",
    `These ${categorySpecs.length} source videos are original generated vertical graphic assets for ${label}.`,
    restriction,
    "They are approved only as owned source inputs for draft creation and Metricool approval queue review.",
    "",
    "Guardrails:",
    "- Keep Metricool in approval_required mode.",
    "- Review captions before posting.",
    "- Do not imply official league, team, creator, platform, or streamer endorsement.",
    "- Replace any asset if a future platform policy or brand review rejects the format.",
    "",
  ].join("\n"));

  return evidencePath;
}

async function appendManifestRows(category: SourceCategory, categorySpecs: OwnedBacklogSpec[], evidencePath: string): Promise<number> {
  const categoryDropDir = path.join(sourceDropDir, category);
  const manifestPath = path.join(categoryDropDir, "source-drop-manifest.csv");
  const header = "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes";
  const current = await readFile(manifestPath, "utf8").catch(() => `${header}\n`);
  const existing = new Set(categorySpecs.filter((spec) => current.includes(spec.fileName)).map((spec) => spec.fileName));
  const rows = categorySpecs
    .filter((spec) => !existing.has(spec.fileName))
    .map((spec, index) => [
      category,
      spec.title,
      `owned-source://weekly-backlog/${category}/${spec.fileName}`,
      spec.label,
      "tiktok",
      spec.fileName,
      "owned_or_permissioned",
      `owner note path: ${evidencePath}`,
      index < 10 ? "high" : "medium",
      category === "sports"
        ? "Original generated sports analysis graphic. No third-party footage, broadcast clips, likeness use, or copyrighted music. Use approval_required queue."
        : category === "streamers"
          ? "Original generated streamer commentary graphic. No raw streamer clip, creator likeness, third-party footage, or copyrighted music. Use approval_required queue."
          : "Original generated vertical meme source. No third-party footage or copyrighted music. Use approval_required queue.",
    ].map(csvCell).join(","));

  if (rows.length === 0) return 0;

  const normalized = current.trim().length === 0
    ? `${header}\n`
    : current.endsWith("\n")
      ? current
      : `${current}\n`;
  await writeFile(manifestPath, normalized + rows.join("\n") + "\n");
  return rows.length;
}

async function main() {
  await mkdir(renderedDir, { recursive: true });

  for (let index = 0; index < specs.length; index += 1) {
    await renderSource(specs[index], index);
  }

  let appended = 0;
  for (const category of ["sports", "memes", "streamers"] as SourceCategory[]) {
    const categorySpecs = specs.filter((spec) => spec.category === category);
    const evidencePath = await writeEvidence(category, categorySpecs);
    appended += await appendManifestRows(category, categorySpecs, evidencePath);
  }

  console.log(`Generated ${specs.length} owned weekly backlog source videos.`);
  console.log(`Appended ${appended} manifest row(s).`);
  console.log(`Sports: ${specs.filter((spec) => spec.category === "sports").length}`);
  console.log(`Memes: ${specs.filter((spec) => spec.category === "memes").length}`);
  console.log(`Streamers: ${specs.filter((spec) => spec.category === "streamers").length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
