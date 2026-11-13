import {
  GITHUB_AUDIT_ROLES, GITHUB_MAX_PULL_REQUESTS, GITHUB_MAX_REPOSITORIES, githubRecordId, sourceDigest, validateRoleSnapshot,
  type AuditPool, type GithubAuditRole, type GithubBlockCode, type RoleSnapshot,
} from "./office-role-snapshots";

/**
 * Read-only GitHub observation for the `github` and `code` office roles.
 * Repositories come only from the owner's app_projects inventory. Requests are
 * GET-only to https://api.github.com with redirect:"error", a per-request
 * timeout, an overall deadline and bounded pagination. The token is only placed
 * in the Authorization header and never appears in snapshots or errors.
 */
export const GITHUB_REQUEST_TIMEOUT_MS = 10_000;
export const GITHUB_READ_DEADLINE_MS = 40_000;
const API = "https://api.github.com";
const MAX_PR_PAGES = 3;
const MAX_BODY_CHARS = 2_000_000;
const CONCURRENCY = 4;
const TOKEN_FORMAT = /^(ghp|github_pat|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{10,255}$/;
const SHA = /^[a-f0-9]{40}$/;
const STATE = /^[a-z_]{1,40}$/;

class GithubReadBlock extends Error {
  constructor(readonly code: GithubBlockCode) { super(code); this.name = "GithubReadBlock"; }
}
type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type Got = { status: "ok"; data: any } | { status: "not_found" | "forbidden" };

/** Accepts "owner/name", "https://github.com/owner/name(.git)"; other hosts are not GitHub repositories. */
export function normalizeRegisteredRepo(githubRepo: unknown, repoOwner: unknown, repoName: unknown): string | null {
  const parse = (value: string) => {
    const match = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/.exec(value.trim());
    if (!match || match[2] === "." || match[2] === "..") return null;
    return `${match[1]}/${match[2]}`.toLowerCase();
  };
  if (typeof githubRepo === "string" && githubRepo.trim()) return parse(githubRepo);
  if (typeof repoOwner === "string" && typeof repoName === "string" && repoOwner.trim() && repoName.trim()) return parse(`${repoOwner.trim()}/${repoName.trim()}`);
  return null;
}

/** Static SQL, owner-bound, same read-only transaction discipline as readRoleSnapshot. */
export async function readRegisteredGithubRepos(pool: AuditPool, owner: string): Promise<string[]> {
  if (!owner.trim()) throw new Error("Unsupported audit source");
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    const identity = await client.query("SELECT id FROM users WHERE id=$1", [owner]);
    if (identity.rows.length !== 1 || identity.rows[0].id !== owner) throw new Error("Canonical owner absent");
    const result = await client.query(`SELECT github_repo AS "githubRepo",repo_owner AS "repoOwner",repo_name AS "repoName" FROM app_projects WHERE user_id=$1 ORDER BY id LIMIT 200`, [owner]);
    await client.query("COMMIT");
    const repos = new Set<string>();
    for (const row of result.rows) { const repo = normalizeRegisteredRepo(row.githubRepo, row.repoOwner, row.repoName); if (repo) repos.add(repo); }
    return [...repos].sort();
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
}

function date(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function state(value: unknown): string | null { return typeof value === "string" && STATE.test(value) ? value : null; }
function int(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function invalid(): never { throw new GithubReadBlock("GITHUB_RESPONSE_INVALID"); }

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await fn(items[index]); }
  }));
  return results;
}

function createClient(options: { token: string | null; fetch: Fetch; requestTimeoutMs: number; deadline: number; run: AbortController; now: () => number }) {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "office-role-audit" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  return async function get(path: string): Promise<Got> {
    if (options.run.signal.aborted) throw new GithubReadBlock("GITHUB_READ_DEADLINE");
    const url = new URL(path, API);
    if (url.origin !== API || url.username || url.password) throw new GithubReadBlock("GITHUB_RESPONSE_INVALID");
    const remaining = options.deadline - options.now();
    if (remaining <= 0) throw new GithubReadBlock("GITHUB_READ_DEADLINE");
    const request = new AbortController();
    let reason: GithubBlockCode | null = null;
    const onRun = () => { reason ??= "GITHUB_READ_DEADLINE"; request.abort(); };
    options.run.signal.addEventListener("abort", onRun, { once: true });
    const timer = setTimeout(() => {
      reason = remaining < options.requestTimeoutMs ? "GITHUB_READ_DEADLINE" : "GITHUB_TIMEOUT";
      request.abort();
    }, Math.min(options.requestTimeoutMs, remaining));
    try {
      let response: Response;
      try { response = await options.fetch(url.toString(), { method: "GET", headers, redirect: "error", signal: request.signal }); }
      catch { throw new GithubReadBlock(reason || "GITHUB_NETWORK_ERROR"); }
      const status = response.status;
      const limited = response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after");
      if (status === 429 || ((status === 403 || status === 401) && limited)) throw new GithubReadBlock("GITHUB_RATE_LIMITED");
      if (status === 401) throw new GithubReadBlock("GITHUB_AUTH_REJECTED");
      if (status === 403) return { status: "forbidden" };
      if (status === 404) return { status: "not_found" };
      if (status !== 200) throw new GithubReadBlock(status >= 500 ? "GITHUB_UPSTREAM_ERROR" : "GITHUB_RESPONSE_INVALID");
      let text: string;
      try { text = await response.text(); } catch { throw new GithubReadBlock(reason || "GITHUB_NETWORK_ERROR"); }
      if (text.length > MAX_BODY_CHARS) invalid();
      try { return { status: "ok", data: JSON.parse(text) }; } catch { return invalid(); }
    } finally {
      clearTimeout(timer);
      options.run.signal.removeEventListener("abort", onRun);
    }
  };
}

const repoPath = (repo: string) => repo.split("/").map(encodeURIComponent).join("/");
const failing = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"]);

async function readRepository(get: (path: string) => Promise<Got>, repo: string) {
  const id = githubRecordId("repository", repo);
  const meta = await get(`/repos/${repoPath(repo)}`);
  if (meta.status !== "ok") return { id, repo, readable: false, archived: null, defaultBranch: null, pushedAt: null, openIssues: null, runsReadable: false, latestRun: null };
  const data = meta.data;
  if (!data || typeof data !== "object" || typeof data.full_name !== "string" || data.full_name.toLowerCase() !== repo || typeof data.default_branch !== "string" || !data.default_branch || data.default_branch.length > 255 || typeof data.archived !== "boolean") invalid();
  const runs = await get(`/repos/${repoPath(repo)}/actions/runs?branch=${encodeURIComponent(data.default_branch)}&per_page=1&exclude_pull_requests=true`);
  let latestRun: { status: string; conclusion: string | null; createdAt: string } | null = null;
  if (runs.status === "ok") {
    if (!runs.data || !Array.isArray(runs.data.workflow_runs)) invalid();
    const run = runs.data.workflow_runs[0];
    if (run) {
      const status = state(run.status), createdAt = date(run.created_at);
      if (!status || !createdAt || (run.conclusion !== null && !state(run.conclusion))) invalid();
      latestRun = { status, conclusion: run.conclusion === null ? null : state(run.conclusion), createdAt };
    }
  }
  return { id, repo, readable: true, archived: data.archived, defaultBranch: data.default_branch, pushedAt: date(data.pushed_at), openIssues: int(data.open_issues_count), runsReadable: runs.status === "ok", latestRun };
}

async function readPullRequests(get: (path: string) => Promise<Got>, repos: string[], detailed: boolean) {
  const rows: any[] = [];
  let truncated = false;
  const listed: Array<{ repo: string; pr: any }> = [];
  // Sequential listing keeps the global PR cap and ordering deterministic.
  for (const repo of repos) {
    let readable = true;
    for (let page = 1; ; page++) {
      const remaining = GITHUB_MAX_PULL_REQUESTS - listed.length;
      if (remaining <= 0) { truncated = true; break; }
      const result = await get(`/repos/${repoPath(repo)}/pulls?state=open&sort=created&direction=asc&per_page=${GITHUB_MAX_PULL_REQUESTS}&page=${page}`);
      if (result.status !== "ok") { readable = false; break; }
      if (!Array.isArray(result.data) || result.data.length > GITHUB_MAX_PULL_REQUESTS) invalid();
      const taken = result.data.slice(0, remaining);
      for (const pr of taken) listed.push({ repo, pr });
      if (result.data.length > taken.length) { truncated = true; break; }
      if (result.data.length < GITHUB_MAX_PULL_REQUESTS) break;
      if (page >= MAX_PR_PAGES) { truncated = true; break; }
    }
    if (!readable) rows.push({ id: githubRecordId("repository", repo), kind: "repository", repo, readable: false });
  }
  const seen = new Set<string>();
  const prs = await mapLimit(listed, CONCURRENCY, async ({ repo, pr }) => {
    const number = pr?.number, sha = pr?.head?.sha, createdAt = date(pr?.created_at), updatedAt = date(pr?.updated_at);
    if (!Number.isSafeInteger(number) || number < 1 || typeof sha !== "string" || !SHA.test(sha) || !createdAt || !updatedAt || typeof pr.draft !== "boolean" || !Array.isArray(pr.requested_reviewers)) invalid();
    let mergeableState: string | null = null;
    if (detailed) {
      const detail = await get(`/repos/${repoPath(repo)}/pulls/${number}`);
      if (detail.status === "ok") mergeableState = state(detail.data?.mergeable_state);
    }
    const checkRuns = await get(`/repos/${repoPath(repo)}/commits/${sha}/check-runs?per_page=100`);
    let checks: { total: number; failing: number; pending: number; passing: number } | null = null;
    if (checkRuns.status === "ok") {
      const list = checkRuns.data?.check_runs;
      if (!Array.isArray(list) || int(checkRuns.data?.total_count) === null) invalid();
      checks = { total: list.length, failing: 0, pending: 0, passing: 0 };
      for (const run of list) {
        if (run?.status !== "completed") checks.pending++;
        else if (failing.has(run?.conclusion)) checks.failing++;
        else checks.passing++;
      }
    }
    const requestedReviewers = pr.requested_reviewers.length + (Array.isArray(pr.requested_teams) ? pr.requested_teams.length : 0);
    return { id: githubRecordId("pull_request", repo, number), kind: "pull_request", repo, number, draft: pr.draft, createdAt, updatedAt, mergeableState, requestedReviewers, checks };
  });
  for (const pr of prs) { if (seen.has(pr.id)) invalid(); seen.add(pr.id); rows.push(pr); }
  return { rows, truncated };
}

export type GithubRoleReadOptions = {
  pool: AuditPool; owner: string; role: GithubAuditRole; token?: string | null;
  fetch?: Fetch; now?: () => number; requestTimeoutMs?: number; deadlineMs?: number;
};

/** Never writes to GitHub. Expected read failures become a persisted, precise
 * blocked snapshot; only inventory/database failures throw (source_unavailable). */
export async function readGithubRoleSnapshot(options: GithubRoleReadOptions): Promise<RoleSnapshot> {
  const now = options.now || Date.now;
  if (!options.owner.trim() || !GITHUB_AUDIT_ROLES.includes(options.role)) throw new Error("Unsupported audit source");
  const registered = await readRegisteredGithubRepos(options.pool, options.owner);
  const repos = registered.slice(0, GITHUB_MAX_REPOSITORIES);
  const build = (rows: any[], total: number, blocked: GithubBlockCode | null, truncated: boolean) => {
    const body = { version: 1 as const, role: options.role, ownerKey: sourceDigest(options.owner), observedAt: new Date(now()).toISOString(), total, rows, github: { blocked, truncated, repositories: blocked === "NO_REGISTERED_REPOSITORIES" ? 0 : registered.length } };
    const snapshot = { ...body, sourceDigest: sourceDigest(body) };
    return validateRoleSnapshot(snapshot, options.owner, Date.parse(body.observedAt));
  };
  if (!registered.length) return build([], 0, "NO_REGISTERED_REPOSITORIES", false);
  const rawToken = options.token?.trim() || null;
  if (rawToken && !TOKEN_FORMAT.test(rawToken)) return build([], 0, "GITHUB_TOKEN_INVALID", false);
  const run = new AbortController();
  const get = createClient({ token: rawToken, fetch: options.fetch || ((url, init) => fetch(url, init)), requestTimeoutMs: options.requestTimeoutMs ?? GITHUB_REQUEST_TIMEOUT_MS, deadline: now() + (options.deadlineMs ?? GITHUB_READ_DEADLINE_MS), run, now });
  // The first blocking failure cancels sibling requests.
  const guarded = async (path: string) => { try { return await get(path); } catch (error) { run.abort(); throw error; } };
  try {
    if (options.role === "github") {
      const rows = await mapLimit(repos, CONCURRENCY, repo => readRepository(guarded, repo));
      return build(rows, registered.length, null, registered.length > GITHUB_MAX_REPOSITORIES);
    }
    const { rows, truncated } = await readPullRequests(guarded, repos, Boolean(rawToken));
    return build(rows, rows.length, null, truncated || registered.length > GITHUB_MAX_REPOSITORIES);
  } catch (error) {
    // Only our own fixed codes survive; raw messages (URLs, headers) are dropped.
    const code = error instanceof GithubReadBlock ? error.code : "GITHUB_RESPONSE_INVALID";
    return build([], 0, code, false);
  }
}
