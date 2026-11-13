import { createHash } from "node:crypto";
import { Octokit } from "@octokit/rest";
import { parseGitHubPullRequestUrl, validateGitHubFilePath } from "./github-client";

const MAX_FILES = 100;
const MAX_PACKET_BYTES = 100 * 1024;
const SHA = /^[a-f0-9]{40}$/i;
export interface OfficePrReference {
  prUrl: string;
  owner: string;
  repo: string;
  repoFullName: string;
  pullNumber: number;
}
export interface OfficePullRequestPacket {
  prUrl: string;
  headSha: string;
  diff: string;
  diffSha256: string;
}
export class OfficeGitHubError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "OfficeGitHubError";
  }
}
function block(code: string, message: string): never {
  throw new OfficeGitHubError(code, message);
}

export function parseOfficePrUrl(value: string): OfficePrReference {
  // Matching the original string also rejects explicit :443, URL normalization,
  // encoded traversal, userinfo, backslashes and other ambiguous URL spellings.
  if (typeof value !== "string" || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(value)) {
    return block("INVALID_PR_URL", "Se necesita una URL canonica de un pull request de GitHub.");
  }
  const parsed = parseGitHubPullRequestUrl(value);
  if (!parsed) return block("INVALID_PR_URL", "La URL del pull request no es valida.");
  return { ...parsed, prUrl: `https://github.com/${parsed.repoFullName}/pull/${parsed.pullNumber}` };
}

type RecordValue = Record<string, unknown>;
interface OfficeGitHubClient {
  pulls: {
    get(input: { owner: string; repo: string; pull_number: number; request?: { timeout: number } }): Promise<{ data: unknown }>;
    listFiles(input: { owner: string; repo: string; pull_number: number; page: number; per_page: number; request?: { timeout: number } }): Promise<{ data: unknown }>;
  };
}

/** Only the credentialless review worker may read public PRs anonymously.
 * Return a narrowed GET-only surface; shared authenticated/write clients are unchanged. */
export async function getOfficePrReadClient(options: {
  env?: NodeJS.ProcessEnv;
  authenticated?: () => Promise<OfficeGitHubClient>;
  publicFetch?: typeof fetch;
} = {}): Promise<OfficeGitHubClient> {
  const env = options.env || process.env;
  const configuredIdentity = [env.GITHUB_TOKEN, env.GH_TOKEN, env.REPL_IDENTITY, env.WEB_REPL_RENEWAL].some(value => Boolean(value?.trim()));
  if (env.OFFICE_WORKER_ENABLED !== "true" || env.OFFICE_WORKER_REVIEW_ONLY !== "true" || configuredIdentity) {
    return (options.authenticated || (async () => (await import("./github-client")).getGitHubClient()))();
  }
  const client = new Octokit({ request: { timeout: 15000, ...(options.publicFetch ? { fetch: options.publicFetch } : {}) } });
  return { pulls: {
    get: ({ owner, repo, pull_number }) => client.pulls.get({ owner, repo, pull_number, request: { timeout: 15000 } }),
    listFiles: ({ owner, repo, pull_number, page, per_page }) => client.pulls.listFiles({ owner, repo, pull_number, page, per_page, request: { timeout: 15000 } }),
  } };
}
interface PrMetadata { headSha: string; baseSha: string; changedFiles: number; additions: number; deletions: number }
interface ReviewedFile { path: string; previousPath?: string; status: string; additions: number; deletions: number; patch: string }
function record(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function metadata(value: unknown, pullNumber: number): PrMetadata {
  if (!record(value) || value.number !== pullNumber || value.state !== "open" || value.merged !== false) {
    return block("PR_NOT_OPEN", "El pull request debe estar abierto y sin fusionar para esta revision.");
  }
  if (!record(value.head) || !record(value.base) || typeof value.head.sha !== "string" || !SHA.test(value.head.sha)
    || typeof value.base.sha !== "string" || !SHA.test(value.base.sha) || !integer(value.changed_files)
    || !integer(value.additions) || !integer(value.deletions)) {
    return block("INVALID_PR_METADATA", "GitHub no entrego metadatos completos y verificables del pull request.");
  }
  if (value.changed_files < 1 || value.changed_files > MAX_FILES) {
    return block("PR_TOO_LARGE", "La revision requiere entre uno y cien archivos; divide este pull request antes de revisarlo.");
  }
  return { headSha: value.head.sha.toLowerCase(), baseSha: value.base.sha.toLowerCase(), changedFiles: value.changed_files, additions: value.additions, deletions: value.deletions };
}

function assertReviewablePath(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length > 1024 || value !== value.trim() || /[\x00-\x1f\x7f\\]/.test(value) || value.includes("//")
    || validateGitHubFilePath(value)
    || value.split("/").some(part => /^\.env(?:\.|$)/i.test(part))
    || /(?:^|\/)(?:CEO_ASSISTANT_ENV(?:\..*)?|\.npmrc|\.pypirc|\.netrc|id_dsa|id_ecdsa)$/i.test(value)
    || /\.(?:pem|key|p12|pfx|keystore)$/i.test(value)) {
    block("SENSITIVE_PATH", "El pull request incluye rutas sensibles o no revisables; no se enviara una revision parcial.");
  }
}

function assertCompletePatch(patch: string, additions: number, deletions: number): void {
  if (!patch || Buffer.byteLength(patch, "utf8") > MAX_PACKET_BYTES || patch.includes("\0")) {
    block("INCOMPLETE_PATCH", "El pull request contiene un parche ausente, binario o demasiado grande.");
  }
  // Avoid sending obvious credential material from a nominally safe source path.
  if (/-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----|\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:ant-|proj-|svcacct-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16})/.test(patch)) {
    block("SENSITIVE_PATCH", "El parche contiene material sensible y no puede enviarse al revisor.");
  }
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let index = 0;
  let totalAdded = 0;
  let totalRemoved = 0;
  let hunks = 0;
  while (index < lines.length) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(lines[index].replace(/\r$/, ""));
    if (!header) block("INCOMPLETE_PATCH", "GitHub entrego un parche incompleto o no verificable.");
    hunks++;
    const oldExpected = Number(header[2] ?? 1);
    const newExpected = Number(header[4] ?? 1);
    if (!Number.isSafeInteger(oldExpected) || !Number.isSafeInteger(newExpected)) block("INCOMPLETE_PATCH", "El parche tiene limites invalidos.");
    let oldSeen = 0;
    let newSeen = 0;
    index++;
    while (index < lines.length && !lines[index].startsWith("@@")) {
      const line = lines[index].replace(/\r$/, "");
      if (line === "\\ No newline at end of file") { index++; continue; }
      if (line.startsWith("+")) { newSeen++; totalAdded++; }
      else if (line.startsWith("-")) { oldSeen++; totalRemoved++; }
      else if (line.startsWith(" ")) { oldSeen++; newSeen++; }
      else block("INCOMPLETE_PATCH", "GitHub entrego un parche incompleto o no verificable.");
      if (oldSeen > oldExpected || newSeen > newExpected) block("INCOMPLETE_PATCH", "El parche no coincide con sus limites declarados.");
      index++;
    }
    if (oldSeen !== oldExpected || newSeen !== newExpected) block("INCOMPLETE_PATCH", "GitHub entrego un parche truncado; la revision queda bloqueada.");
  }
  if (!hunks || totalAdded !== additions || totalRemoved !== deletions) {
    block("INCOMPLETE_PATCH", "El parche no cubre todos los cambios declarados por GitHub.");
  }
}

function filePacket(value: unknown): ReviewedFile {
  if (!record(value)) return block("INVALID_FILES", "GitHub no entrego una lista de archivos verificable.");
  assertReviewablePath(value.filename);
  if (!integer(value.additions) || !integer(value.deletions) || typeof value.patch !== "string"
    || !["added", "modified", "removed", "renamed"].includes(String(value.status))) {
    return block("INCOMPLETE_PATCH", "El pull request contiene cambios sin un parche de texto completo.");
  }
  let previousPath: string | undefined;
  if (value.status === "renamed") {
    assertReviewablePath(value.previous_filename);
    previousPath = value.previous_filename;
  } else if (value.previous_filename !== undefined) {
    return block("INVALID_FILES", "GitHub devolvio una ruta anterior incoherente para un archivo.");
  }
  assertCompletePatch(value.patch, value.additions, value.deletions);
  return { path: value.filename, ...(previousPath ? { previousPath } : {}), status: String(value.status), additions: value.additions, deletions: value.deletions, patch: value.patch };
}

export function createOfficeGitHubLoader(dependencies: { getClient?: () => Promise<OfficeGitHubClient> } = {}) {
  const getClient = dependencies.getClient ?? getOfficePrReadClient;
  async function loadOfficePullRequest(prUrl: string): Promise<OfficePullRequestPacket> {
    const reference = parseOfficePrUrl(prUrl);
    try {
      const client = await getClient();
      const input = { owner: reference.owner, repo: reference.repo, pull_number: reference.pullNumber, request: { timeout: 15_000 } };
      const before = metadata((await client.pulls.get(input)).data, reference.pullNumber);
      const files: ReviewedFile[] = [];
      for (let page = 1; page <= 2; page++) {
        const response = await client.pulls.listFiles({ ...input, page, per_page: 100 });
        if (!Array.isArray(response.data) || response.data.length > 100) return block("INVALID_FILES", "GitHub no entrego una pagina de archivos verificable.");
        if (files.length + response.data.length > MAX_FILES) return block("PR_TOO_LARGE", "El pull request supera el limite de cien archivos.");
        for (const file of response.data) files.push(filePacket(file));
        if (response.data.length < 100) break;
      }
      if (files.length !== before.changedFiles || new Set(files.map(file => file.path)).size !== files.length
        || files.reduce((sum, file) => sum + file.additions, 0) !== before.additions
        || files.reduce((sum, file) => sum + file.deletions, 0) !== before.deletions) {
        return block("INCOMPLETE_FILES", "La lista de archivos no cubre exactamente el pull request; no se enviara una revision parcial.");
      }
      const after = metadata((await client.pulls.get(input)).data, reference.pullNumber);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        return block("PR_CHANGED", "El pull request cambio durante la lectura. Repite la revision sobre su version actual.");
      }
      const diff = JSON.stringify({ schemaVersion: "1", prUrl: reference.prUrl, headSha: before.headSha, baseSha: before.baseSha, files: files.sort((a, b) => a.path.localeCompare(b.path)) });
      if (Buffer.byteLength(diff, "utf8") > MAX_PACKET_BYTES) return block("PR_TOO_LARGE", "El paquete completo supera cien KiB; divide el pull request para revisarlo sin omisiones.");
      return { prUrl: reference.prUrl, headSha: before.headSha, diff, diffSha256: createHash("sha256").update(diff, "utf8").digest("hex") };
    } catch (error) {
      if (error instanceof OfficeGitHubError) throw error;
      return block("GITHUB_UNAVAILABLE", "No se pudo leer el pull request. Las revisiones sin credenciales solo pueden acceder a repositorios publicos.");
    }
  }
  return { loadOfficePullRequest };
}

export const { loadOfficePullRequest } = createOfficeGitHubLoader();
