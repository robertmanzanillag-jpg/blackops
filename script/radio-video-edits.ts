import path from "node:path";
import os from "node:os";
import { processRadioVideos } from "../server/radio-video-edit-agent";
import { getSystemUserId } from "../server/user-context";
import { hasRealValue } from "../server/ceo-doctor-cli";

function envFlag(name: string): boolean {
  return ["1", "true", "yes"].includes(String(process.env[name] || "").toLowerCase());
}

function resolveOptionalPathEnv(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (hasRealValue(value)) return value;
  throw new Error(`${name} must be a real filesystem path, not a placeholder.`);
}

async function main() {
  const userId = hasRealValue(process.env.USER_ID) ? process.env.USER_ID : getSystemUserId();
  const sourceDir = resolveOptionalPathEnv("SOURCE_DIR", path.join(os.homedir(), "Movies"));
  const fallbackInputDir = resolveOptionalPathEnv("FALLBACK_INPUT_DIR", path.join(process.cwd(), "radio_video_edits", "01_originales"));
  const outputDir = resolveOptionalPathEnv("OUTPUT_DIR", path.join(process.cwd(), "radio_video_edits", "03_listos_para_subir"));
  const searchDepth = Number.parseInt(process.env.SEARCH_DEPTH || "3", 10);
  const force = envFlag("FORCE");

  console.log("Radio video edits");
  console.log(`Source: ${sourceDir}`);
  console.log(`Output: ${outputDir}`);

  const results = await processRadioVideos({
    userId,
    sourceDir,
    fallbackInputDir,
    outputDir,
    searchDepth: Number.isFinite(searchDepth) ? searchDepth : 3,
    force,
  });

  if (results.length === 0) {
    console.log("No encontre videos para procesar.");
    return;
  }

  for (const result of results) {
    const fileName = path.basename(result.videoPath);
    if (result.status === "completed") {
      console.log(`Listo: ${fileName} -> ${result.djName}`);
      for (const clip of result.clips || []) {
        console.log(`  ${clip.width}x${clip.height} ${clip.durationSeconds}s ${clip.path}`);
      }
      continue;
    }
    if (result.status === "needs_dj_name") {
      console.log(`Pendiente nombre DJ: ${fileName}`);
      console.log(`  PendingAction: ${result.pendingActionId}`);
      console.log(`  Telegram: nombre ${result.pendingActionId} DJ_NAME`);
      continue;
    }
    console.log(`Fallo: ${fileName} - ${result.error || "error desconocido"}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
