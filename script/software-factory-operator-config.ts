// Deterministic, noncredential generator for the Asistente factory operator JSON.
// Reads the checks workflow and the UI harness from one exact base commit with
// `git show <commit>:<path>`, computes the digests exactly as the readers do and
// validates the result with the real operator schema before printing it.
// It performs no network call, reads no environment secrets and writes no file.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { validateAsistenteOperatorConfig } from "../server/software-factory-asistente-operator";
import { FACTORY_DEFAULT_WRITE_ROOTS, isFactoryWritePathAllowed } from "../server/software-factory-write-scope";
import { FACTORY_SELECTION_MAX_LISTED_PATHS } from "../server/software-factory-company-auto";
import { OFFICE_UI_HARNESS_FILES } from "./software-factory-ui-static.mjs";

export const FACTORY_CHECKS_WORKFLOW_PATH = ".github/workflows/factory-candidate-checks.yml";
/** Job/step names the readers verify on the pinned workflow run. */
export const FACTORY_CHECKS_JOB_NAME = "isolated-checks";
export const FACTORY_CHECKS_STEPS = { testStep: "Isolated tests", buildStep: "Isolated build", browserStep: "Isolated browser recovery tests" } as const;
/** Steps the office UI artifact reader requires by name (software-factory-office-ui-artifact.ts). */
export const FACTORY_UI_READER_STEPS = ["Exact revision office UI regression", "Save measured office UI regression"] as const;
/** Size limits enforced by the readers on the contents API response. */
const ACTIONS_WORKFLOW_MAX_BYTES = 65536, UI_FILE_MAX_BYTES = 100000;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** Same as software-factory-actions.ts preflight and the UI reader: SHA-256 of the raw blob bytes. */
export function factoryWorkflowSha256(workflow: Uint8Array): string { return sha256(workflow); }
/** Same as software-factory-office-ui-artifact.ts: SHA-256 of JSON.stringify([[path, sha256(bytes)], ...])
 * in OFFICE_UI_HARNESS_FILES order (the workflow itself is excluded). */
export function factoryHarnessSha256(files: ReadonlyArray<readonly [string, Uint8Array]>): string {
  if (files.length !== OFFICE_UI_HARNESS_FILES.length || files.some(([path], i) => path !== OFFICE_UI_HARNESS_FILES[i])) throw Error("FACTORY_HARNESS_FILES_INVALID");
  return sha256(Buffer.from(JSON.stringify(files.map(([path, bytes]) => [path, sha256(bytes)]))));
}

/** Verifies the single isolated job and every step name the readers look up exist exactly once. */
export function verifyFactoryWorkflowShape(workflow: string): void {
  const lines = workflow.split(/\r?\n/), jobsAt = lines.findIndex(l => /^jobs:\s*$/.test(l));
  if (jobsAt < 0) throw Error("FACTORY_WORKFLOW_JOBS_MISSING");
  const jobs = lines.slice(jobsAt + 1).map(l => /^  ([A-Za-z0-9_-]+):\s*$/.exec(l)?.[1]).filter((x): x is string => !!x);
  if (jobs.length !== 1 || jobs[0] !== FACTORY_CHECKS_JOB_NAME) throw Error("FACTORY_WORKFLOW_JOB_INVALID");
  const steps = lines.map(l => /^\s+- name:\s*(.+?)\s*$/.exec(l)?.[1]).filter((x): x is string => !!x);
  for (const name of [...Object.values(FACTORY_CHECKS_STEPS), ...FACTORY_UI_READER_STEPS])
    if (steps.filter(s => s === name).length !== 1) throw Error(`FACTORY_WORKFLOW_STEP_MISSING:${name}`);
}

export interface GitSource { commit: string; read(path: string): Buffer; mode(path: string): string; list(): Array<{ mode: string; type: string; path: string }> }
export function gitSource(repoDir: string, ref: string): GitSource {
  const git = (args: string[]) => execFileSync("git", ["-C", repoDir, ...args], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
  const commit = git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).toString("utf8").trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error("FACTORY_BASE_COMMIT_INVALID");
  const list = () => git(["ls-tree", "-r", "-z", commit]).toString("utf8").split("\0").filter(Boolean).map(row => {
    const [meta, path] = row.split("\t"); const [mode, type] = meta.split(" "); return { mode, type, path };
  });
  return { commit, list, read: path => git(["show", `${commit}:${path}`]),
    mode: path => git(["ls-tree", "-z", commit, "--", path]).toString("utf8").split(" ")[0] };
}

export interface OperatorConfigInput {
  owner: string; baseBranch: string; workflowId: number; archiveHosts: string[];
  autoAdmitSince?: string; allowGitHubResultsAzureHosts?: boolean;
}
export function buildOperatorConfig(input: OperatorConfigInput, source: Pick<GitSource, "read" | "mode">) {
  const blob = (path: string, max: number) => {
    if (!["100644", "100755"].includes(source.mode(path))) throw Error(`FACTORY_TRUSTED_FILE_NOT_REGULAR:${path}`);
    const bytes = source.read(path);
    if (bytes.length > max) throw Error(`FACTORY_TRUSTED_FILE_TOO_LARGE:${path}`);
    return bytes;
  };
  const workflow = blob(FACTORY_CHECKS_WORKFLOW_PATH, ACTIONS_WORKFLOW_MAX_BYTES);
  verifyFactoryWorkflowShape(workflow.toString("utf8"));
  const workflowSha256 = factoryWorkflowSha256(workflow);
  const harnessSha256 = factoryHarnessSha256(OFFICE_UI_HARNESS_FILES.map(path => [path, blob(path, UI_FILE_MAX_BYTES)] as const));
  const archiveHosts = [...new Set(input.archiveHosts)].sort();
  return validateAsistenteOperatorConfig({
    owner: input.owner, projectId: "asistente", baseBranch: input.baseBranch,
    writeRoots: [...FACTORY_DEFAULT_WRITE_ROOTS], maxFilesPerOrder: 6, maxDraftPullRequestsPerDay: 5,
    checks: { trigger: "push", workflowId: input.workflowId, workflowPath: FACTORY_CHECKS_WORKFLOW_PATH, workflowSha256, jobName: FACTORY_CHECKS_JOB_NAME, ...FACTORY_CHECKS_STEPS },
    allowGitHubResultsAzureHosts: input.allowGitHubResultsAzureHosts === true,
    archiveHosts,
    reservations: { discover: 10, build: 100, simulate: 1, review: 50 },
    maxInputTokens: 32000, maxOutputTokens: 8192,
    orders: [],
    ui: { workflowId: input.workflowId, workflowSha256, harnessSha256 },
    ...(input.autoAdmitSince ? { autoAdmit: { enabled: true, since: input.autoAdmitSince, maxPerDay: 5 } } : {}),
  });
}

/** Zero-cost sizing of the automatic selection listing (same filter as listFactorySelectablePaths). */
export function selectionListingEstimate(source: Pick<GitSource, "list">, roots: readonly string[], maxFiles: number) {
  const rows = source.list(), paths = rows.filter(r => r.type === "blob" && r.mode === "100644" && isFactoryWritePathAllowed(r.path, roots)).map(r => r.path).sort();
  const bytes = Buffer.byteLength(JSON.stringify({ maxFiles, requirements: "x".repeat(500), files: paths }));
  return { selectablePaths: paths.length, withinListingLimit: paths.length <= FACTORY_SELECTION_MAX_LISTED_PATHS, listingBytes: bytes, estimatedInputTokens: Math.ceil(bytes / 4) };
}

export function parseOperatorConfigArgs(argv: readonly string[]): OperatorConfigInput & { ref?: string; repoDir?: string } {
  const out: Partial<OperatorConfigInput> & { archiveHosts: string[]; ref?: string; repoDir?: string } = { archiveHosts: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--allow-github-results-azure-hosts") { out.allowGitHubResultsAzureHosts = true; continue; }
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) throw Error(`FACTORY_ARG_VALUE_REQUIRED:${flag}`);
    if (flag === "--owner") out.owner = value;
    else if (flag === "--base-branch") out.baseBranch = value;
    else if (flag === "--workflow-id") { if (!/^[1-9][0-9]{0,15}$/.test(value)) throw Error("FACTORY_ARG_WORKFLOW_ID_INVALID"); out.workflowId = Number(value); }
    else if (flag === "--archive-host") out.archiveHosts.push(value);
    else if (flag === "--auto-admit-since") out.autoAdmitSince = value;
    else if (flag === "--ref") out.ref = value;
    else if (flag === "--repo-dir") out.repoDir = value;
    else throw Error(`FACTORY_ARG_UNKNOWN:${flag}`);
  }
  if (!out.owner || !out.baseBranch || !out.workflowId || !out.archiveHosts.length) throw Error("FACTORY_ARGS_REQUIRED: --owner --base-branch --workflow-id --archive-host");
  return out as OperatorConfigInput & { ref?: string; repoDir?: string };
}

function main() {
  const args = parseOperatorConfigArgs(process.argv.slice(2));
  const source = gitSource(args.repoDir ?? process.cwd(), args.ref ?? `origin/${args.baseBranch}`);
  const config = buildOperatorConfig(args, source);
  const listing = selectionListingEstimate(source, config.writeRoots, config.maxFilesPerOrder);
  // Diagnostics go to stderr so stdout stays exactly the operator JSON.
  console.error(JSON.stringify({ baseCommit: source.commit, ...listing, discoverReservationCents: config.reservations.discover }));
  process.stdout.write(JSON.stringify(config, null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : "FACTORY_OPERATOR_CONFIG_FAILED"); process.exitCode = 1; }
}
