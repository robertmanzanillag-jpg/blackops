import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ENV_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  ".env.replit",
  "CEO_ASSISTANT_ENV",
  "CEO_ASSISTANT_ENV.local",
];

export const CLIPPERS_ALLOWED_ENV_KEYS = new Set([
  "CLIPPERS_CONFIG_ROOT",
  "CLIPPERS_FREE_WORKER_CLEANUP_EXECUTE",
  "CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED",
  "CLIPPERS_METRICOOL_BLOG_ID",
  "CLIPPERS_MARKETPLACE_REFRESH_CONFIG",
  "CLIPPERS_MARKETPLACE_REFRESH_TIMEOUT_MS",
  "CLIPPERS_PUBLIC_MEDIA_PROVIDER",
  "CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED",
  "CLIPPERS_TARGET_DAILY_CLIPS",
  "CLIPPERS_TIKTOK_ACCOUNT",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_OAUTH_CLIENT_ID",
  "GOOGLE_DRIVE_OAUTH_CLIENT_SECRET",
  "GOOGLE_DRIVE_REFRESH_TOKEN",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_REFRESH_TOKEN",
  "METRICOOL_USER_ID",
  "METRICOOL_USER_TOKEN",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_OAUTH_CLIENT_ID",
  "YOUTUBE_OAUTH_CLIENT_SECRET",
  "YOUTUBE_REFRESH_TOKEN",
]);

function parseSelectedLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const clean = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
  const separator = clean.indexOf("=");
  if (separator <= 0) return null;
  const key = clean.slice(0, separator).trim();
  if (!CLIPPERS_ALLOWED_ENV_KEYS.has(key)) return null;
  let value = clean.slice(separator + 1).trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

export function loadClipperSelectedEnv(projectRoot, env = process.env) {
  const loadedFiles = [];
  for (const filename of ENV_FILES) {
    const filePath = path.join(projectRoot, filename);
    if (!existsSync(filePath)) continue;
    let loaded = 0;
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const parsed = parseSelectedLine(line);
      if (!parsed || (typeof env[parsed.key] === "string" && env[parsed.key].trim())) continue;
      env[parsed.key] = parsed.value;
      loaded += 1;
    }
    if (loaded) loadedFiles.push(filename);
  }
  return loadedFiles;
}
