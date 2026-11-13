import { createHash } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

type YtDlpDownloadMode = "video" | "audio";

export type YtDlpCommandSpec = {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
};

type CookieSecretCandidate = {
  label: string;
  value: string;
};

const DEFAULT_MAX_YT_DLP_VARIANTS = 18;

function hasConfiguredValue(value?: string | null): value is string {
  if (!value) return false;
  const normalized = value.trim();
  return Boolean(normalized) && !/^(changeme|change-me|todo|replace|replace-with|your-|<.*>)$/i.test(normalized);
}

function normalizeCookieFileContent(rawValue: string): string {
  const normalized = rawValue.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function looksLikeYoutubeCookieFile(rawValue: string): boolean {
  const normalized = normalizeCookieFileContent(rawValue);
  const hasCookieHeader = /Netscape HTTP Cookie File/i.test(normalized);
  const hasCookieRows = /(?:^|\n)(?:#HttpOnly_)?\.?(?:youtube|google)\.com\t(?:TRUE|FALSE)\t/i.test(normalized);
  return hasCookieHeader && hasCookieRows;
}

function normalizeDecodedCookieSecret(rawValue: string): string | null {
  const normalized = normalizeCookieFileContent(rawValue);
  if (looksLikeYoutubeCookieFile(normalized)) return normalized;

  const headerIndex = normalized.search(/#\s*Netscape HTTP Cookie File/i);
  if (headerIndex > 0) {
    const sliced = normalizeCookieFileContent(normalized.slice(headerIndex));
    if (looksLikeYoutubeCookieFile(sliced)) return sliced;
  }

  return null;
}

function decodeBase64CookieSecret(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  const encoded = trimmed.startsWith("data:")
    ? trimmed.slice(trimmed.indexOf(",") + 1)
    : trimmed;
  const decoded = Buffer.from(encoded.replace(/\s+/g, ""), "base64").toString("utf8");
  return hasConfiguredValue(decoded) ? normalizeDecodedCookieSecret(decoded) : null;
}

function writeCookieSecretToTempFile(rawCookieFile: string): string {
  const cookieFile = normalizeCookieFileContent(rawCookieFile);
  const digest = createHash("sha256").update(cookieFile).digest("hex").slice(0, 16);
  const cookiePath = join(tmpdir(), `yt-dlp-youtube-cookies-${digest}.txt`);
  writeFileSync(cookiePath, cookieFile, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(cookiePath, 0o600);
  } catch {
    // Best effort only. The file is still written outside the repo and never logged.
  }
  return cookiePath;
}

function uniqueCookieCandidates(candidates: CookieSecretCandidate[]): CookieSecretCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const normalized = candidate.value.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function readEnvChunkCandidates(baseName: string, maxChunks = 200): CookieSecretCandidate[] {
  const chunks: Array<{ index: number; key: string; value: string }> = [];
  for (let index = 1; index <= maxChunks; index += 1) {
    const paddedIndex = String(index).padStart(3, "0");
    const unpaddedKey = `${baseName}_${index}`;
    const paddedKey = `${baseName}_${paddedIndex}`;
    const value = process.env[unpaddedKey] || process.env[paddedKey];
    if (hasConfiguredValue(value)) {
      chunks.push({
        index,
        key: process.env[unpaddedKey] ? unpaddedKey : paddedKey,
        value: value.trim(),
      });
    }
  }
  if (!chunks.length) return [];

  const numeric = [...chunks].sort((a, b) => a.index - b.index);
  const lexicographic = [...chunks].sort((a, b) => a.key.localeCompare(b.key));
  return uniqueCookieCandidates([
    { label: `${baseName}_numeric`, value: numeric.map((chunk) => chunk.value).join("") },
    { label: `${baseName}_lexicographic`, value: lexicographic.map((chunk) => chunk.value).join("") },
  ]);
}

function configuredYoutubeCookieFileFromSecret(): string | null {
  const base64Candidates = uniqueCookieCandidates([
    ...readEnvChunkCandidates("YT_DLP_COOKIES_B64"),
    ...readEnvChunkCandidates("YT_DLP_COOKIES_BASE64"),
    { label: "YT_DLP_COOKIES_B64", value: process.env.YT_DLP_COOKIES_B64 || "" },
    { label: "YT_DLP_COOKIES_BASE64", value: process.env.YT_DLP_COOKIES_BASE64 || "" },
  ]);

  for (const candidate of base64Candidates) {
    if (!hasConfiguredValue(candidate.value)) continue;
    const decoded = decodeBase64CookieSecret(candidate.value);
    if (decoded) return writeCookieSecretToTempFile(decoded);
  }

  const rawCandidates = uniqueCookieCandidates([
    ...readEnvChunkCandidates("YT_DLP_COOKIES"),
    { label: "YT_DLP_COOKIES", value: process.env.YT_DLP_COOKIES || "" },
  ]);
  for (const candidate of rawCandidates) {
    if (!hasConfiguredValue(candidate.value)) continue;
    const normalized = normalizeDecodedCookieSecret(candidate.value);
    if (normalized) return writeCookieSecretToTempFile(normalized);
  }

  return null;
}

function configuredYoutubeCookieArgs(): string[] {
  const cookiesPath = process.env.YT_DLP_COOKIES_PATH?.trim();
  if (hasConfiguredValue(cookiesPath)) return ["--cookies", cookiesPath];

  const cookiesSecretPath = configuredYoutubeCookieFileFromSecret();
  if (cookiesSecretPath) return ["--cookies", cookiesSecretPath];

  const cookiesFromBrowser = process.env.YT_DLP_COOKIES_FROM_BROWSER?.trim();
  if (hasConfiguredValue(cookiesFromBrowser)) return ["--cookies-from-browser", cookiesFromBrowser];

  return [];
}

function configuredYoutubeCookieArgVariants(explicitCookieArgs?: string[]): string[][] {
  if (explicitCookieArgs) return [explicitCookieArgs];

  const configured = configuredYoutubeCookieArgs();
  if (configured.length === 0) return [[]];

  // A stale browser cookie export can make YouTube return HTTP 400/precondition errors.
  // Try the authenticated path first, then fall back to the anonymous extractor path.
  return [configured, []];
}

function uniqueCommandSpecs(specs: YtDlpCommandSpec[]): YtDlpCommandSpec[] {
  const seen = new Set<string>();
  return specs.filter((spec) => {
    const key = `${spec.command}\0${spec.args.join("\0")}\0${spec.env?.PYTHONPATH || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function configuredJsRuntimeVariants(): string[][] {
  const rawRuntimes = process.env.YT_DLP_JS_RUNTIMES?.trim();
  if (/^(0|false|off|none|disabled)$/i.test(rawRuntimes || "")) {
    return [[]];
  }

  const runtimes = hasConfiguredValue(rawRuntimes)
    ? rawRuntimes.split(/[,\s]+/).map((runtime) => runtime.trim()).filter(Boolean)
    : ["node"];

  const remoteComponents = process.env.YT_DLP_REMOTE_COMPONENTS?.trim() || "ejs:github";
  const allowRemoteComponents = hasConfiguredValue(remoteComponents)
    && !/^(0|false|off|none|disabled)$/i.test(remoteComponents);

  return [
    [],
    ...runtimes.flatMap((runtime) => [
      ...(allowRemoteComponents ? [["--js-runtimes", runtime, "--remote-components", remoteComponents]] : []),
      ["--js-runtimes", runtime],
    ]),
  ];
}

function configuredYoutubeClientVariants(): string[][] {
  const rawClients = process.env.YT_DLP_YOUTUBE_CLIENTS?.trim();
  if (/^(0|false|off|none|disabled)$/i.test(rawClients || "")) return [[]];

  const clientSets = hasConfiguredValue(rawClients)
    ? rawClients.split(/[;\n]+/).map((clientSet) => clientSet.trim()).filter(Boolean)
    : [
        "web,ios,android",
        "mweb",
      ];

  return [
    [],
    ...clientSets.map((clientSet) => ["--extractor-args", `youtube:player_client=${clientSet}`]),
  ];
}

function configuredImpersonateTargets(): string[] {
  const rawTargets = process.env.YT_DLP_IMPERSONATE_TARGETS?.trim();
  if (/^(0|false|off|none|disabled)$/i.test(rawTargets || "")) return [];

  return hasConfiguredValue(rawTargets)
    ? rawTargets.split(/[,\s;]+/).map((target) => target.trim()).filter(Boolean)
    : ["chrome"];
}

function configuredMaxYtDlpVariants(): number {
  const parsed = Number.parseInt(process.env.YT_DLP_MAX_VARIANTS || "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return Math.max(1, Math.min(parsed, 100));
  return DEFAULT_MAX_YT_DLP_VARIANTS;
}

function formatVariants(mode: YtDlpDownloadMode): string[] {
  if (mode === "audio") return ["ba/bestaudio/best"];

  return [
    "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080][ext=mp4]/b[height<=1080]/best[height<=1080]/best",
    "bv*[height<=1080]+ba/b[height<=1080]/best[height<=1080]/best",
    "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
  ];
}

function pythonEnvForPackageDir(packageDir: string): NodeJS.ProcessEnv {
  const currentPythonPath = process.env.PYTHONPATH?.trim();
  return {
    ...process.env,
    PYTHONPATH: currentPythonPath ? `${packageDir}${delimiter}${currentPythonPath}` : packageDir,
  };
}

export function buildYtDlpCommandSpecs(params: {
  url: string;
  outputTemplate: string;
  mode: YtDlpDownloadMode;
  explicitBinary?: string;
  cookieArgs?: string[];
  freshPythonPackageDir?: string | null;
}): YtDlpCommandSpec[] {
  const cookieArgVariants = configuredYoutubeCookieArgVariants(params.cookieArgs);
  const clientVariants = configuredYoutubeClientVariants();
  const formats = formatVariants(params.mode);
  const runtimeVariants = configuredJsRuntimeVariants();
  const impersonateTargets = hasConfiguredValue(params.freshPythonPackageDir)
    ? configuredImpersonateTargets()
    : [];
  const binaries: Array<{ command: string; argsPrefix?: string[]; env?: NodeJS.ProcessEnv }> = [
    ...(hasConfiguredValue(params.freshPythonPackageDir)
      ? [{ command: "python3", argsPrefix: ["-m", "yt_dlp"], env: pythonEnvForPackageDir(params.freshPythonPackageDir) }]
      : []),
    ...(params.explicitBinary?.trim() ? [{ command: params.explicitBinary.trim() }] : []),
    { command: "yt-dlp" },
    { command: "python3", argsPrefix: ["-m", "yt_dlp"] },
    { command: "python", argsPrefix: ["-m", "yt_dlp"] },
  ];

  const buildArgs = (binary: typeof binaries[number], options: {
    runtimeArgs?: string[];
    clientArgs?: string[];
    impersonateArgs?: string[];
    cookieArgs: string[];
    format: string;
  }): YtDlpCommandSpec => ({
    command: binary.command,
    env: binary.env,
    args: [
      ...(binary.argsPrefix || []),
      ...(options.runtimeArgs || []),
      ...(options.clientArgs || []),
      ...(options.impersonateArgs || []),
      "--no-playlist",
      ...options.cookieArgs,
      "--socket-timeout",
      "30",
      "--retries",
      "2",
      "--fragment-retries",
      "2",
      "--extractor-retries",
      "2",
      "-f",
      options.format,
      ...(params.mode === "video" ? ["--merge-output-format", "mp4"] : []),
      "--restrict-filenames",
      "-o",
      params.outputTemplate,
      params.url,
    ],
  });

  const primaryFormat = formats[0];
  const impersonateSpecs = binaries.flatMap((binary) =>
    impersonateTargets.flatMap((target) =>
      cookieArgVariants.map((cookieArgs) => buildArgs(binary, {
        impersonateArgs: ["--impersonate", target],
        cookieArgs,
        format: primaryFormat,
      }))
    )
  );

  const fallbackSpecs = binaries.flatMap((binary) => runtimeVariants.flatMap((runtimeArgs) =>
    clientVariants.flatMap((clientArgs) => formats.flatMap((format) =>
      cookieArgVariants.map((cookieArgs) => buildArgs(binary, {
        runtimeArgs,
        clientArgs,
        cookieArgs,
        format,
      }))
    ))
  ));

  return uniqueCommandSpecs([...impersonateSpecs, ...fallbackSpecs]).slice(0, configuredMaxYtDlpVariants());
}

export function formatYtDlpFailureMessage(rawError: string, mediaLabel: "video" | "audio" = "video"): string {
  const lower = rawError.toLowerCase();
  const meaningfulError = rawError
    .split(/\n+/)
    .filter((line) => !/no such option:\s*--js-runtimes|unsupported option.*js-runtimes/i.test(line))
    .join("\n")
    .trim();
  const meaningfulLower = meaningfulError.toLowerCase();
  const errorForGenericDetail = meaningfulError || rawError;

  if (/sign in to confirm|not a bot|confirm you.?re not a bot|use --cookies|cookies for the authentication|http error 429/.test(meaningfulLower || lower)) {
    return [
      `No pude descargar el ${mediaLabel} de YouTube porque YouTube bloqueó la descarga desde Replit con verificación de bot/login.`,
      "Google Drive puede estar conectado bien; el bloqueo ocurre antes, al bajar el YouTube.",
      "Para automatizarlo de forma estable, configura cookies de YouTube en Replit Secrets YT_DLP_COOKIES_B64 o YT_DLP_COOKIES_B64_1/_2 cuando el export sea grande; no pegues cookies en el chat. Alternativa: sube el MP4 fuente a Google Drive y pásame ese archivo como entrada.",
    ].join(" ");
  }

  if (/no such option:\s*--js-runtimes|unsupported option.*js-runtimes/.test(lower)) {
    return [
      `No pude descargar el ${mediaLabel} de YouTube porque la versión de yt-dlp disponible en Replit es demasiado vieja para resolver YouTube moderno.`,
      "El deploy debe usar el paquete Python actualizado de yt-dlp incluido en la build; si vuelve a pasar, revisa que la build haya instalado yt-dlp fresco y que YT_DLP_AUTO_UPDATE no esté desactivado.",
    ].join(" ");
  }

  if (/no supported javascript runtime could be found|javascript runtime/.test(meaningfulLower || lower)) {
    return [
      `No pude descargar el ${mediaLabel} de YouTube porque falta un runtime JavaScript para yt-dlp.`,
      "Instala deno en Replit y vuelve a intentar.",
    ].join(" ");
  }

  if (/precondition check failed|signature extraction failed|only images are available|requested format is not available|unable to download api page|http error 400|bad request/.test(meaningfulLower || lower)) {
    return [
      `No pude descargar el ${mediaLabel} de YouTube porque YouTube devolvió formatos inválidos o incompletos para yt-dlp.`,
      "Esto suele pasar cuando yt-dlp está viejo o cuando las cookies de YouTube expiraron/rompen el extractor.",
      "El agente intenta primero un yt-dlp actualizado, node con remote-components ejs:github, y también prueba con y sin cookies; si sigue pasando, regenera los secrets YT_DLP_COOKIES_B64_* o usa un MP4 fuente desde Google Drive.",
    ].join(" ");
  }

  if (/command not found|enoent|no module named yt_dlp|no module named yt-dlp/.test(meaningfulLower || lower)) {
    return [
      `No pude descargar el ${mediaLabel} de YouTube porque yt-dlp no está instalado o no está en PATH.`,
      "Instala yt-dlp en Replit o configura YT_DLP_PATH con la ruta correcta.",
    ].join(" ");
  }

  return `No pude descargar el ${mediaLabel} de YouTube. Detalle: ${errorForGenericDetail}`;
}
