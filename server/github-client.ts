// GitHub integration using Replit Connectors
import { Octokit } from '@octokit/rest';
import { diagnoseGitHubTokenEnv, gitHubSetupReason } from "./github-token-diagnosis";

let connectionSettings: any;

const MAX_GITHUB_FILE_WRITE_BYTES = 1024 * 1024;
const MAX_GITHUB_ISSUE_BODY_BYTES = 64 * 1024;
const BLOCKED_GITHUB_PATH_SEGMENTS = new Set([
  '.git',
  '.ssh',
  'credentials',
  'secrets',
  'node_modules',
]);
const BLOCKED_GITHUB_FILE_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  'id_rsa',
  'id_ed25519',
]);

export function getConfiguredGitHubToken(env: NodeJS.ProcessEnv = process.env): string | null {
  return diagnoseGitHubTokenEnv(env).token;
}

function githubInputError(message: string): Error & { status?: number; statusCode?: number } {
  const error = new Error(message) as Error & { status?: number; statusCode?: number };
  error.status = 400;
  error.statusCode = 400;
  return error;
}

export function validateGitHubRepoNamePart(value: string, label: string): string | null {
  if (!/^[A-Za-z0-9_.-]+$/.test(value) || value === '.' || value === '..') {
    return `${label} invalido`;
  }
  return null;
}

export function validateGitHubFilePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (!normalized) return 'Path requerido';
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return 'Path absoluto no permitido';
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return 'Path traversal no permitido';
  if (segments.some((segment) => BLOCKED_GITHUB_PATH_SEGMENTS.has(segment.toLowerCase()))) {
    return 'Path bloqueado por politica de seguridad';
  }
  const fileName = segments[segments.length - 1]?.toLowerCase();
  if (BLOCKED_GITHUB_FILE_NAMES.has(fileName)) return 'Archivo sensible no permitido';
  return null;
}

export function validateGitHubCommitMessage(message: string): string | null {
  const trimmed = message.trim();
  if (trimmed.length < 8) return 'Commit message demasiado corto';
  if (trimmed.length > 200) return 'Commit message demasiado largo';
  if (/[\r\n]/.test(trimmed)) return 'Commit message multilinea no permitido';
  return null;
}

export function validateGitHubIssueTitle(title: string): string | null {
  const trimmed = title.trim();
  if (trimmed.length < 8) return 'Issue title demasiado corto';
  if (trimmed.length > 200) return 'Issue title demasiado largo';
  if (/[\r\n]/.test(trimmed)) return 'Issue title multilinea no permitido';
  return null;
}

export function validateGitHubIssueBody(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.length < 20) return 'Issue body demasiado corto';
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_GITHUB_ISSUE_BODY_BYTES) return 'Issue body demasiado grande';
  return null;
}

export function validateGitHubIssueNumber(value: number, label = 'Issue/PR number'): string | null {
  if (!Number.isInteger(value) || value <= 0 || value > 1_000_000) return `${label} invalido`;
  return null;
}

export type GitHubPullRequestUrlParts = {
  owner: string;
  repo: string;
  repoFullName: string;
  pullNumber: number;
};

export type GitHubPullRequestReleaseStatus = {
  pr: {
    number: number;
    title: string;
    htmlUrl: string;
    state: string;
    draft: boolean;
    merged: boolean;
    baseRef: string;
    headRef: string;
    headSha: string;
    author: string;
    updatedAt: string | null;
  };
  checks: {
    total: number;
    passed: number;
    pending: number;
    failed: number;
  };
  statuses: {
    total: number;
    passed: number;
    pending: number;
    failed: number;
    state: string;
  };
  approvedReviews: Array<{
    reviewer: string;
    htmlUrl: string;
    submittedAt: string | null;
  }>;
  changesRequestedReviews: Array<{
    reviewer: string;
    htmlUrl: string;
    submittedAt: string | null;
  }>;
  secondReviewEvidenceUrl: string;
  appQaEvidenceUrl: string;
  blockers: string[];
  warnings: string[];
  readyForReleaseEvidence: boolean;
};

export type GitHubAppQaTargetEvidence = {
  workspaceId?: string;
  clientName?: string;
  repoFullName?: string;
  branchName?: string;
  routePath?: string;
};

export function parseGitHubPullRequestUrl(value: string): GitHubPullRequestUrlParts | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }

  if (!['github.com', 'www.github.com'].includes(parsed.hostname.toLowerCase())) return null;
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length !== 4 || segments[2] !== 'pull') return null;

  const [owner, repo, , pullNumberText] = segments;
  const pullNumber = Number(pullNumberText);
  if (
    validateGitHubRepoNamePart(owner, 'Owner')
    || validateGitHubRepoNamePart(repo, 'Repo')
    || validateGitHubIssueNumber(pullNumber, 'Pull request number')
  ) {
    return null;
  }

  return {
    owner,
    repo,
    repoFullName: `${owner}/${repo}`,
    pullNumber,
  };
}

export function validateGitHubFileWriteInput(input: {
  owner: string;
  repo: string;
  path: string;
  content: string;
  message: string;
}): string | null {
  return validateGitHubRepoNamePart(input.owner, 'Owner')
    || validateGitHubRepoNamePart(input.repo, 'Repo')
    || validateGitHubFilePath(input.path)
    || validateGitHubCommitMessage(input.message)
    || (Buffer.byteLength(input.content, 'utf8') > MAX_GITHUB_FILE_WRITE_BYTES ? 'Archivo demasiado grande para escritura remota desde el asistente' : null);
}

function latestReviewByReviewer(reviews: Array<Record<string, any>>): Array<Record<string, any>> {
  const latest = new Map<string, Record<string, any>>();
  for (const review of reviews) {
    const reviewer = String(review.user?.login || '');
    if (!reviewer) continue;
    const current = latest.get(reviewer);
    const currentTime = current?.submitted_at ? new Date(current.submitted_at).getTime() : 0;
    const nextTime = review.submitted_at ? new Date(review.submitted_at).getTime() : 0;
    if (!current || nextTime >= currentTime) latest.set(reviewer, review);
  }
  return [...latest.values()];
}

function isTrustedPrEvidenceComment(comment: Record<string, any>): boolean {
  const association = String(comment.author_association || '').toUpperCase();
  return ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(association);
}

function commentIncludesAppQaTargetEvidence(body: string, target?: GitHubAppQaTargetEvidence): boolean {
  if (!target) return true;
  const normalized = body.toLowerCase();
  if (!normalized.includes('app qa target')) return false;
  const requiredValues = [
    target.workspaceId,
    target.clientName,
    target.repoFullName,
    target.branchName,
    target.routePath,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);

  return requiredValues.every((value) => normalized.includes(value));
}

function isPassingAppQaCommentForHead(comment: Record<string, any>, headSha: string, target?: GitHubAppQaTargetEvidence): boolean {
  const body = String(comment.body || '');
  const normalized = body.toLowerCase();
  return /\bapp\s*qa\b/.test(normalized)
    && /\b(pass|passed|approve|approved|green|ok|no blockers|sin blockers|aprobado|aprobada)\b/.test(normalized)
    && headSha.length >= 7
    && normalized.includes(headSha.toLowerCase())
    && commentIncludesAppQaTargetEvidence(body, target)
    && isTrustedPrEvidenceComment(comment);
}

async function getAccessToken() {
  const configuredToken = getConfiguredGitHubToken();
  if (configuredToken) {
    return configuredToken;
  }

  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('GitHub no conectado - token no disponible');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      signal: AbortSignal.timeout(15_000),
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub no conectado');
  }
  return accessToken;
}

// Get fresh GitHub client (never cache - tokens expire)
export async function getGitHubClient(): Promise<Octokit> {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

// List user's repositories
export async function listRepositories() {
  const octokit = await getGitHubClient();
  const data = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
    sort: 'updated',
    per_page: 100,
  });
  return data.map(repo => ({
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    private: repo.private,
    archived: repo.archived,
    disabled: repo.disabled,
    fork: repo.fork,
    html_url: repo.html_url,
    homepage: repo.homepage,
    default_branch: repo.default_branch,
    updated_at: repo.updated_at,
    pushed_at: repo.pushed_at,
    open_issues_count: repo.open_issues_count,
    language: repo.language
  }));
}

export async function getRepositoryOverview(owner: string, repo: string) {
  const octokit = await getGitHubClient();
  const [{ data }, issues, prs] = await Promise.all([
    octokit.repos.get({ owner, repo }),
    octokit.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:issue is:open`,
      per_page: 1,
    }).catch(() => ({ data: { total_count: null } })),
    octokit.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:pr is:open`,
      per_page: 1,
    }).catch(() => ({ data: { total_count: null } })),
  ]);

  return {
    id: data.id,
    name: data.name,
    full_name: data.full_name,
    description: data.description,
    private: data.private,
    archived: data.archived,
    disabled: data.disabled,
    html_url: data.html_url,
    homepage: data.homepage,
    default_branch: data.default_branch,
    language: data.language,
    pushed_at: data.pushed_at,
    updated_at: data.updated_at,
    stargazers_count: data.stargazers_count,
    forks_count: data.forks_count,
    open_issues_count: data.open_issues_count,
    open_issues: issues.data.total_count,
    open_prs: prs.data.total_count,
  };
}

export function summarizeGitHubPullRequestReleaseStatus(input: {
  pr: Record<string, any>;
  reviews: Array<Record<string, any>>;
  comments: Array<Record<string, any>>;
  checksData: Record<string, any>;
  statusesData: Record<string, any>;
  checksUnavailable?: boolean;
  statusesUnavailable?: boolean;
  expectedBranch?: string;
  appQaTargetEvidence?: GitHubAppQaTargetEvidence;
}): GitHubPullRequestReleaseStatus {
  const pr = input.pr;
  const latestReviews = latestReviewByReviewer(input.reviews);
  const approvedReviews = latestReviews
    .filter((review) => review.state === 'APPROVED' && review.commit_id === pr.head.sha)
    .map((review) => ({
      reviewer: String(review.user?.login || 'unknown'),
      htmlUrl: String(review.html_url || ''),
      submittedAt: review.submitted_at ? String(review.submitted_at) : null,
    }))
    .filter((review) => review.htmlUrl);
  const changesRequestedReviews = latestReviews
    .filter((review) => review.state === 'CHANGES_REQUESTED')
    .map((review) => ({
      reviewer: String(review.user?.login || 'unknown'),
      htmlUrl: String(review.html_url || ''),
      submittedAt: review.submitted_at ? String(review.submitted_at) : null,
    }))
    .filter((review) => review.htmlUrl);

  const checkRuns = Array.isArray(input.checksData?.check_runs) ? input.checksData.check_runs as Array<Record<string, any>> : [];
  const completedChecks = checkRuns.filter((check) => check.status === 'completed');
  const failedChecks = completedChecks.filter((check) => !['success', 'neutral', 'skipped'].includes(String(check.conclusion || '')));
  const pendingChecks = checkRuns.filter((check) => check.status !== 'completed');

  const statusList = Array.isArray(input.statusesData?.statuses) ? input.statusesData.statuses as Array<Record<string, any>> : [];
  const failedStatuses = statusList.filter((status) => ['failure', 'error'].includes(String(status.state || '')));
  const pendingStatuses = statusList.filter((status) => String(status.state || '') === 'pending');
  const passedStatuses = statusList.filter((status) => String(status.state || '') === 'success');

  const appQaComment = [...input.comments]
    .reverse()
    .find((comment) => isPassingAppQaCommentForHead(comment, String(pr.head.sha || ''), input.appQaTargetEvidence));

  const expectedBranch = input.expectedBranch?.trim();
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (pr.state !== 'open') blockers.push('PR no esta abierto.');
  if (pr.draft) blockers.push('PR esta en draft.');
  if (pr.merged) blockers.push('PR ya esta merged.');
  if (expectedBranch && pr.head.ref !== expectedBranch) {
    blockers.push(`Branch del PR (${pr.head.ref}) no coincide con el workspace (${expectedBranch}).`);
  }
  if (changesRequestedReviews.length > 0) blockers.push('Hay review con changes requested pendiente.');
  if (approvedReviews.length === 0) blockers.push('Falta second-agent review aprobado en el PR head actual.');
  if (input.checksUnavailable) blockers.push('No se pudo verificar GitHub checks.');
  if (input.statusesUnavailable) blockers.push('No se pudo verificar GitHub statuses.');
  if (failedChecks.length > 0) blockers.push('Hay GitHub checks fallando.');
  if (failedStatuses.length > 0) blockers.push('Hay GitHub statuses fallando.');
  if (pendingChecks.length > 0) blockers.push('Hay GitHub checks pendientes.');
  if (pendingStatuses.length > 0) blockers.push('Hay GitHub statuses pendientes.');
  if (!appQaComment) blockers.push(input.appQaTargetEvidence
    ? 'Falta comentario/evidencia App QA pass para el PR head actual con target del workspace.'
    : 'Falta comentario/evidencia App QA pass para el PR head actual.');

  if (!input.checksUnavailable && !input.statusesUnavailable && checkRuns.length === 0 && statusList.length === 0) {
    warnings.push('GitHub no reporto checks/statuses; registra checks manuales y App QA antes del release gate.');
  }

  return {
    pr: {
      number: Number(pr.number),
      title: String(pr.title || ''),
      htmlUrl: String(pr.html_url || ''),
      state: String(pr.state || ''),
      draft: Boolean(pr.draft),
      merged: Boolean(pr.merged),
      baseRef: String(pr.base?.ref || ''),
      headRef: String(pr.head?.ref || ''),
      headSha: String(pr.head?.sha || ''),
      author: pr.user?.login || 'unknown',
      updatedAt: pr.updated_at || null,
    },
    checks: {
      total: checkRuns.length,
      passed: completedChecks.length - failedChecks.length,
      pending: pendingChecks.length,
      failed: failedChecks.length,
    },
    statuses: {
      total: statusList.length,
      passed: passedStatuses.length,
      pending: pendingStatuses.length,
      failed: failedStatuses.length,
      state: String(input.statusesData?.state || 'unknown'),
    },
    approvedReviews,
    changesRequestedReviews,
    secondReviewEvidenceUrl: approvedReviews[0]?.htmlUrl || '',
    appQaEvidenceUrl: String(appQaComment?.html_url || ''),
    blockers,
    warnings,
    readyForReleaseEvidence: blockers.length === 0,
  };
}

export async function getGitHubPullRequestReleaseStatus(input: {
  repoFullName: string;
  pullNumber: number;
  expectedBranch?: string;
  appQaTargetEvidence?: GitHubAppQaTargetEvidence;
}): Promise<GitHubPullRequestReleaseStatus> {
  const [owner = '', repo = ''] = input.repoFullName.split('/');
  const ownerError = validateGitHubRepoNamePart(owner, 'Owner');
  const repoError = validateGitHubRepoNamePart(repo, 'Repo');
  const numberError = validateGitHubIssueNumber(input.pullNumber, 'Pull request number');
  if (!owner || !repo || ownerError || repoError || numberError) {
    throw githubInputError(ownerError || repoError || numberError || 'GitHub PR input invalido');
  }

  const octokit = await getGitHubClient();
  const pull = await octokit.pulls.get({
    owner,
    repo,
    pull_number: input.pullNumber,
  });

  const pr = pull.data;
  const [reviews, comments, checksResult, statusesResult] = await Promise.all([
    octokit.paginate(octokit.pulls.listReviews, {
      owner,
      repo,
      pull_number: input.pullNumber,
      per_page: 100,
    }),
    octokit.paginate(octokit.issues.listComments, {
      owner,
      repo,
      issue_number: input.pullNumber,
      per_page: 100,
    }),
    octokit.checks.listForRef({
      owner,
      repo,
      ref: pr.head.sha,
      per_page: 100,
    }).then((result) => ({ ok: true as const, data: result.data })).catch(() => ({ ok: false as const, data: { check_runs: [] } })),
    octokit.repos.getCombinedStatusForRef({
      owner,
      repo,
      ref: pr.head.sha,
    }).then((result) => ({ ok: true as const, data: result.data })).catch(() => ({ ok: false as const, data: { state: 'unknown', statuses: [] } })),
  ]);

  return summarizeGitHubPullRequestReleaseStatus({
    pr,
    reviews: reviews as Array<Record<string, any>>,
    comments: comments as Array<Record<string, any>>,
    checksData: checksResult.data,
    statusesData: statusesResult.data,
    checksUnavailable: !checksResult.ok,
    statusesUnavailable: !statusesResult.ok,
    expectedBranch: input.expectedBranch,
    appQaTargetEvidence: input.appQaTargetEvidence,
  });
}

// Get repository contents (files/folders)
export async function getRepoContents(owner: string, repo: string, path: string = '') {
  const ownerError = validateGitHubRepoNamePart(owner, 'Owner');
  const repoError = validateGitHubRepoNamePart(repo, 'Repo');
  const pathError = path ? validateGitHubFilePath(path) : null;
  if (ownerError || repoError || pathError) throw githubInputError(ownerError || repoError || pathError || 'GitHub input invalido');

  const octokit = await getGitHubClient();
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path
    });
    
    if (Array.isArray(data)) {
      return data.map(item => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        sha: item.sha
      }));
    } else {
      // Single file
      return {
        name: data.name,
        path: data.path,
        type: data.type,
        size: data.size,
        sha: data.sha,
        content: 'content' in data ? Buffer.from(data.content, 'base64').toString('utf-8') : null
      };
    }
  } catch (error: any) {
    if (error.status === 404) {
      return [];
    }
    throw error;
  }
}

// Get file content
export async function getFileContent(owner: string, repo: string, path: string) {
  const ownerError = validateGitHubRepoNamePart(owner, 'Owner');
  const repoError = validateGitHubRepoNamePart(repo, 'Repo');
  const pathError = validateGitHubFilePath(path);
  if (ownerError || repoError || pathError) throw githubInputError(ownerError || repoError || pathError || 'GitHub input invalido');

  const octokit = await getGitHubClient();
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path
  });
  
  if (Array.isArray(data)) {
    throw new Error('La ruta es un directorio, no un archivo');
  }
  
  if (!('content' in data)) {
    throw new Error('No se pudo obtener el contenido del archivo');
  }
  
  return {
    name: data.name,
    path: data.path,
    sha: data.sha,
    content: Buffer.from(data.content, 'base64').toString('utf-8')
  };
}

// Create or update file in repository
export async function updateFile(
  owner: string, 
  repo: string, 
  path: string, 
  content: string, 
  message: string,
  sha?: string
) {
  const validationError = validateGitHubFileWriteInput({ owner, repo, path, content, message });
  if (validationError) throw githubInputError(validationError);

  const octokit = await getGitHubClient();
  
  // If no SHA provided, try to get it (for updates)
  let fileSha = sha;
  if (!fileSha) {
    try {
      const existing = await getFileContent(owner, repo, path);
      fileSha = existing.sha;
    } catch (e) {
      // File doesn't exist, will create new
    }
  }
  
  const { data } = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: Buffer.from(content).toString('base64'),
    sha: fileSha
  });
  
  return {
    success: true,
    commit: data.commit.sha,
    file: {
      path: data.content?.path,
      sha: data.content?.sha
    }
  };
}

// Delete file from repository
export async function deleteFile(
  owner: string,
  repo: string,
  path: string,
  message: string,
  sha: string
) {
  const ownerError = validateGitHubRepoNamePart(owner, 'Owner');
  const repoError = validateGitHubRepoNamePart(repo, 'Repo');
  const pathError = validateGitHubFilePath(path);
  const messageError = validateGitHubCommitMessage(message);
  if (ownerError || repoError || pathError || messageError) {
    throw githubInputError(ownerError || repoError || pathError || messageError || 'GitHub input invalido');
  }

  const octokit = await getGitHubClient();
  
  const { data } = await octokit.repos.deleteFile({
    owner,
    repo,
    path,
    message,
    sha
  });
  
  return {
    success: true,
    commit: data.commit.sha
  };
}

export async function createIssue(
  owner: string,
  repo: string,
  title: string,
  body: string,
) {
  const ownerError = validateGitHubRepoNamePart(owner, 'Owner');
  const repoError = validateGitHubRepoNamePart(repo, 'Repo');
  const titleError = validateGitHubIssueTitle(title);
  const bodyError = validateGitHubIssueBody(body);
  if (ownerError || repoError || titleError || bodyError) {
    throw githubInputError(ownerError || repoError || titleError || bodyError || 'GitHub issue input invalido');
  }

  const octokit = await getGitHubClient();
  const { data } = await octokit.issues.create({
    owner,
    repo,
    title: title.trim(),
    body: body.trim(),
  });

  return {
    id: data.id,
    number: data.number,
    title: data.title,
    html_url: data.html_url,
    state: data.state,
  };
}

export async function createIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
) {
  const ownerError = validateGitHubRepoNamePart(owner, 'Owner');
  const repoError = validateGitHubRepoNamePart(repo, 'Repo');
  const numberError = validateGitHubIssueNumber(issueNumber);
  const bodyError = validateGitHubIssueBody(body);
  if (ownerError || repoError || numberError || bodyError) {
    throw githubInputError(ownerError || repoError || numberError || bodyError || 'GitHub comment input invalido');
  }

  const octokit = await getGitHubClient();
  const { data } = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: body.trim(),
  });

  return {
    id: data.id,
    html_url: data.html_url,
    body: data.body,
  };
}

// Get authenticated user info
export async function getAuthenticatedUser() {
  const octokit = await getGitHubClient();
  const { data } = await octokit.users.getAuthenticated();
  return {
    login: data.login,
    name: data.name,
    avatar_url: data.avatar_url,
    html_url: data.html_url
  };
}

// Same check as isGitHubConnected, with a credential-free reason when it fails.
export async function diagnoseGitHubConnection(): Promise<{ connected: boolean; reason?: string }> {
  const env = diagnoseGitHubTokenEnv();
  let client: Octokit;
  try {
    client = await getGitHubClient();
  } catch {
    return { connected: false, reason: gitHubSetupReason(env, { stage: "connector" }) };
  }
  try {
    await client.users.getAuthenticated();
    return { connected: true };
  } catch (error) {
    const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : undefined;
    return { connected: false, reason: gitHubSetupReason(env, { stage: "api", status }) };
  }
}

// Check if GitHub is connected
export async function isGitHubConnected(): Promise<boolean> {
  try {
    const client = await getGitHubClient();
    await client.users.getAuthenticated();
    return true;
  } catch {
    return false;
  }
}
