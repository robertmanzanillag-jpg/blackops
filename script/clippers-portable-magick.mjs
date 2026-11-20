// Portable ImageMagick calls for the Clippers renderers (macOS operator Mac and Linux cloud runners).
// - ImageMagick 6 (ubuntu-24.04 apt) ships `convert`; ImageMagick 7 (Homebrew) ships `magick`.
// - The macOS font name "Arial-Bold" does not exist on Linux: off macOS the bundled DejaVu Sans Bold is used,
//   unless CLIPPERS_FONT_PATH points to another font file. On macOS the output is unchanged.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const BUNDLED_FONT_PATH = fileURLToPath(new URL("../assets/fonts/DejaVuSans-Bold.ttf", import.meta.url));
const clean = (value) => String(value ?? "").trim();

export function portableMagickArgs(args, env = process.env, platform = process.platform) {
  const font = clean(env.CLIPPERS_FONT_PATH) || (platform === "darwin" ? "" : BUNDLED_FONT_PATH);
  if (!font) return args;
  return args.map((value, index) => (value === "Arial-Bold" && args[index - 1] === "-font" ? font : value));
}

export function magickCandidates(env = process.env) {
  const configured = clean(env.CLIPPERS_MAGICK_BIN);
  return configured === "magick" || configured === "convert" ? [configured] : ["magick", "convert"];
}

/** execFile for "magick" with the portable binary + font; first candidate that exists wins. */
export async function execMagick(args, options = {}, { env = process.env, platform = process.platform, exec = execFileAsync } = {}) {
  const portable = portableMagickArgs(args, env, platform);
  const candidates = magickCandidates(env);
  for (const [index, candidate] of candidates.entries()) {
    try {
      return await exec(candidate, portable, options);
    } catch (error) {
      if (error?.code !== "ENOENT" || index === candidates.length - 1) throw error;
    }
  }
  throw new Error("magick_unavailable");
}
