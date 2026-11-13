import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const LOCAL_ENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.production",
  ".env.production.local",
  ".env.replit",
  "CEO_ASSISTANT_ENV",
  "CEO_ASSISTANT_ENV.local",
];

const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

function stripInlineComment(value: string): string {
  let quote: "\"" | "'" | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ((character === "\"" || character === "'") && value[index - 1] !== "\\") {
      quote = quote === character ? null : quote ?? character;
      continue;
    }
    if (character === "#" && quote === null && (index === 0 || /\s/.test(value[index - 1] ?? ""))) {
      return value.slice(0, index).trimEnd();
    }
  }

  return value;
}

function stripOptionalQuotes(value: string): string {
  const trimmed = stripInlineComment(value).trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const clean = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const separatorIndex = clean.indexOf("=");
  if (separatorIndex <= 0) return null;

  const key = clean.slice(0, separatorIndex).trim();
  if (!ENV_KEY_PATTERN.test(key)) return null;

  return {
    key,
    value: stripOptionalQuotes(clean.slice(separatorIndex + 1)),
  };
}

export function loadEnvFile(filePath: string, env: NodeJS.ProcessEnv = process.env): number {
  const raw = readFileSync(filePath, "utf8");
  let loaded = 0;

  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    const existing = parsed ? env[parsed.key] : undefined;
    if (!parsed || (existing !== undefined && existing.trim() !== "")) continue;

    env[parsed.key] = parsed.value;
    loaded += 1;
  }

  return loaded;
}

export function loadLocalEnvFiles(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): string[] {
  const loadedFiles: string[] = [];

  for (const fileName of LOCAL_ENV_FILES) {
    const filePath = path.join(cwd, fileName);
    if (!existsSync(filePath)) continue;
    const loaded = loadEnvFile(filePath, env);
    if (loaded > 0) loadedFiles.push(fileName);
  }

  return loadedFiles;
}
