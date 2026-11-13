import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateGitHubFilePath, validateGitHubRepoNamePart } from "./github-client";
import type { FactoryBuilderDependencies } from "./software-factory-builder";

interface GitTreeEntry { path?: string; mode?: string; type?: string; sha?: string; size?: number }
/** Pass an authenticated Octokit client from trusted host configuration. No token
 * discovery, subprocesses, archive extraction, or GitHub mutations occur here. */
export interface FactoryGitHubReadClient {
  rest: { git: {
    getCommit(input: { owner: string; repo: string; commit_sha: string }): Promise<{ data: { sha: string; tree: { sha: string } } }>;
    getTree(input: { owner: string; repo: string; tree_sha: string; recursive: string }): Promise<{ data: { sha: string; truncated: boolean; tree: GitTreeEntry[] } }>;
    getBlob(input: { owner: string; repo: string; file_sha: string }): Promise<{ data: { sha: string; encoding: string; content: string; size: number } }>;
  } };
}
export interface FactoryGitHubExportOptions {
  client: FactoryGitHubReadClient;
  /** Trusted inventory allowlist, not supplied by a model or repository. */
  repositories: readonly string[];
  /** Explicit trusted subset; omission retains the original full export. */
  sourcePaths?: readonly string[];
  signal?: AbortSignal;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}
const sha = /^[a-f0-9]{40}$/;
const protectedSegment = /^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|credentials|secrets|node_modules|id_rsa|id_ed25519)$/i;
const privateKeyName = /\.(?:pem|key|p12|pfx)$/i;
function repositoryParts(repository: string) {
  const parts = repository.split("/");
  if (parts.length !== 2 || parts.some(part => validateGitHubRepoNamePart(part, "repository"))) throw new Error("FACTORY_GITHUB_REPOSITORY_INVALID");
  return { owner: parts[0], repo: parts[1] };
}
function safePath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 1000 || /[\\:\x00-\x1f\x7f]/.test(value) || value.startsWith("/")) return false;
  return value.split("/").every(segment => !!segment && segment !== "." && segment !== ".." && !/[. ]$/.test(segment) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment));
}
function protectedPath(value: string) {
  return value.split("/").some(segment => protectedSegment.test(segment) || privateKeyName.test(segment)) || validateGitHubFilePath(value) !== null;
}
function limit(value: number | undefined, fallback: number) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > fallback) throw new Error("FACTORY_GITHUB_EXPORT_LIMIT_INVALID");
  return selected;
}

/** Exports only ordinary tracked blobs from an immutable commit. Symlinks and
 * submodules block the export; protected files are omitted before blob fetching.
 * The destination must be a private, empty directory owned by the trusted builder.
 * On failure, the builder owns cleanup of its partial temporary workspace.
 *
 * PR publication intentionally remains a separate required adapter: it must
 * apply the exact tested patch, attest its hash and parent revision, and reconcile
 * branch/PR creation idempotently before claiming success. No publisher is faked.
 */
export function createGitHubFactorySourceExporter(options: FactoryGitHubExportOptions): NonNullable<FactoryBuilderDependencies["exportSource"]> {
  if (!options.repositories.length) throw new Error("FACTORY_GITHUB_REPOSITORY_ALLOWLIST_REQUIRED");
  const allowed = new Set(options.repositories.map(repository => { repositoryParts(repository); return repository.toLowerCase(); }));
  const maxFiles = limit(options.maxFiles, 10000), maxFileBytes = limit(options.maxFileBytes, 4 * 1024 * 1024), maxTotalBytes = limit(options.maxTotalBytes, 64 * 1024 * 1024);
  const client = options.client, signal=options.signal;
  const selected=options.sourcePaths===undefined?undefined:new Set(options.sourcePaths);
  if(selected && (!selected.size||selected.size>64||selected.size!==options.sourcePaths!.length||[...selected].some(p=>!safePath(p)||protectedPath(p))))throw Error("FACTORY_GITHUB_SOURCE_PATHS_INVALID");
  const check=()=>signal?.throwIfAborted();
  return async (repository, commitSha, destination) => {
    check();
    const repo = repositoryParts(repository);
    if (!allowed.has(repository.toLowerCase())) throw new Error("FACTORY_GITHUB_REPOSITORY_NOT_ALLOWED");
    if (!sha.test(commitSha)) throw new Error("FACTORY_GITHUB_EXACT_COMMIT_REQUIRED");
    const rootInfo = await lstat(destination);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (await readdir(destination)).length) throw new Error("FACTORY_GITHUB_EMPTY_WORKSPACE_REQUIRED");
    const root = await realpath(destination);
    check();
    const commit = (await client.rest.git.getCommit({ ...repo, commit_sha: commitSha })).data;
    check();
    if (commit.sha !== commitSha || !sha.test(commit.tree.sha)) throw new Error("FACTORY_GITHUB_COMMIT_MISMATCH");
    const tree = (await client.rest.git.getTree({ ...repo, tree_sha: commit.tree.sha, recursive: "1" })).data;
    check();
    if (tree.sha !== commit.tree.sha || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > maxFiles * 2) throw new Error("FACTORY_GITHUB_TREE_UNVERIFIED");
    const entries: Array<{ path: string; sha: string; size: number; executable: boolean }> = [];
    const seen = new Map<string, string>();
    let total = 0;
    for (const entry of tree.tree) {
      if (!safePath(entry.path) || !entry.sha || !sha.test(entry.sha)) throw new Error("FACTORY_GITHUB_TREE_ENTRY_INVALID");
      const normalized = entry.path.normalize("NFC").toLowerCase();
      if (seen.has(normalized)) throw new Error("FACTORY_GITHUB_PATH_COLLISION");
      seen.set(normalized, entry.type || "");
      if (entry.type === "commit" || entry.mode === "160000" || entry.mode === "120000") throw new Error("FACTORY_GITHUB_SPECIAL_FILE_UNSUPPORTED");
      if (entry.type === "tree" && entry.mode === "040000") continue;
      if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode || "")) throw new Error("FACTORY_GITHUB_SPECIAL_FILE_UNSUPPORTED");
      if (protectedPath(entry.path)) continue;
      if(selected&&!selected.has(entry.path))continue;
      if(selected&&entry.mode!=="100644")throw Error("FACTORY_GITHUB_SOURCE_MODE_INVALID");
      if (!Number.isSafeInteger(entry.size) || entry.size! < 0 || entry.size! > maxFileBytes) throw new Error("FACTORY_GITHUB_FILE_LIMIT");
      total += entry.size!;
      if (total > maxTotalBytes || entries.length >= maxFiles) throw new Error("FACTORY_GITHUB_EXPORT_LIMIT");
      entries.push({ path: entry.path, sha: entry.sha, size: entry.size!, executable: entry.mode === "100755" });
    }
    if(selected&&entries.length!==selected.size)throw Error("FACTORY_GITHUB_SOURCE_MISSING");
    // No path can use an ordinary file as an ancestor, including case aliases.
    for (const entryPath of seen.keys()) {
      const segments = entryPath.split("/");
      for (let index = 1; index < segments.length; index++) {
        if (seen.get(segments.slice(0, index).join("/")) !== "tree") throw new Error("FACTORY_GITHUB_TREE_PARENT_INVALID");
      }
    }
    for (const entry of entries) {
      check();
      const blob = (await client.rest.git.getBlob({ ...repo, file_sha: entry.sha })).data;
      check();
      if (blob.sha !== entry.sha || blob.encoding !== "base64" || blob.size !== entry.size || typeof blob.content !== "string" || blob.content.length > Math.ceil(maxFileBytes / 3) * 4 + Math.ceil(maxFileBytes / 40)) throw new Error("FACTORY_GITHUB_BLOB_UNVERIFIED");
      const encoded = blob.content.replace(/[\r\n]/g, "");
      const bytes = Buffer.from(encoded, "base64");
      const actualSha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      if (bytes.length !== entry.size || bytes.toString("base64") !== encoded || actualSha !== entry.sha) throw new Error("FACTORY_GITHUB_BLOB_MISMATCH");
      const target = path.resolve(root, ...entry.path.split("/"));
      if (!target.startsWith(root + path.sep)) throw new Error("FACTORY_GITHUB_PATH_ESCAPE");
      await mkdir(path.dirname(target), { recursive: true });
      // Reject an unexpected linked ancestor before writing, even in an empty export.
      let parent = path.dirname(target);
      while (parent !== root) {
        const info = await lstat(parent);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("FACTORY_GITHUB_WORKSPACE_CHANGED");
        parent = path.dirname(parent);
      }
      check();
      await writeFile(target, bytes, { flag: "wx", mode: entry.executable ? 0o700 : 0o600 });
    }
    check();
    return { sha: commitSha };
  };
}
