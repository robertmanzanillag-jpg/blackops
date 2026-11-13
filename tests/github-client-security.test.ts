import assert from "node:assert/strict";
import test from "node:test";
import {
  createIssue,
  createIssueComment,
  deleteFile,
  getConfiguredGitHubToken,
  parseGitHubPullRequestUrl,
  summarizeGitHubPullRequestReleaseStatus,
  updateFile,
  validateGitHubCommitMessage,
  validateGitHubFilePath,
  validateGitHubIssueNumber,
  validateGitHubIssueBody,
  validateGitHubIssueTitle,
  validateGitHubFileWriteInput,
  validateGitHubRepoNamePart,
} from "../server/github-client";

function buildReleaseStatusInput(overrides: Partial<Parameters<typeof summarizeGitHubPullRequestReleaseStatus>[0]> = {}) {
  const headSha = "abc123def456";
  return {
    pr: {
      number: 12,
      title: "Client build",
      html_url: "https://github.com/owner/repo/pull/12",
      state: "open",
      draft: false,
      merged: false,
      base: { ref: "main" },
      head: { ref: "codex/client-build", sha: headSha },
      user: { login: "codex" },
      updated_at: "2026-06-30T00:00:00Z",
    },
    reviews: [{
      state: "APPROVED",
      commit_id: headSha,
      html_url: "https://github.com/owner/repo/pull/12#pullrequestreview-1",
      submitted_at: "2026-06-30T00:01:00Z",
      user: { login: "reviewer" },
    }],
    comments: [{
      body: `App QA passed for ${headSha}. no blockers.`,
      html_url: "https://github.com/owner/repo/pull/12#issuecomment-1",
      author_association: "OWNER",
      user: { login: "robert" },
    }],
    checksData: {
      check_runs: [{
        status: "completed",
        conclusion: "success",
      }],
    },
    statusesData: {
      state: "success",
      statuses: [{
        state: "success",
      }],
    },
    expectedBranch: "codex/client-build",
    ...overrides,
  };
}

test("GitHub token fallback uses only real environment tokens", () => {
  assert.equal(getConfiguredGitHubToken({}), null);
  assert.equal(getConfiguredGitHubToken({ GITHUB_TOKEN: "replace-with-token" } as NodeJS.ProcessEnv), null);
  assert.equal(getConfiguredGitHubToken({ GH_TOKEN: "token" } as NodeJS.ProcessEnv), null);
  assert.equal(getConfiguredGitHubToken({ GH_TOKEN: "fake-github-token" } as NodeJS.ProcessEnv), null);
  assert.equal(getConfiguredGitHubToken({ GH_TOKEN: "abc" } as NodeJS.ProcessEnv), null);
  assert.equal(getConfiguredGitHubToken({ GH_TOKEN: "ghp_realLocalTokenForQa" } as NodeJS.ProcessEnv), "ghp_realLocalTokenForQa");
  assert.equal(
    getConfiguredGitHubToken({
      GITHUB_TOKEN: "github_pat_realLocalTokenForQa",
      GH_TOKEN: "ghp_other",
    } as NodeJS.ProcessEnv),
    "github_pat_realLocalTokenForQa",
  );
  assert.equal(
    getConfiguredGitHubToken({
      GITHUB_TOKEN: "fake-github-token",
      GH_TOKEN: "ghp_realFallbackTokenForQa",
    } as NodeJS.ProcessEnv),
    "ghp_realFallbackTokenForQa",
  );
});

test("GitHub repo identifiers reject traversal and shell-like input", () => {
  assert.equal(validateGitHubRepoNamePart("robert", "Owner"), null);
  assert.equal(validateGitHubRepoNamePart("asistente.repo-1", "Repo"), null);
  assert.match(validateGitHubRepoNamePart("../owner", "Owner") || "", /Owner invalido/);
  assert.match(validateGitHubRepoNamePart("repo/name", "Repo") || "", /Repo invalido/);
  assert.match(validateGitHubRepoNamePart("repo;rm", "Repo") || "", /Repo invalido/);
});

test("GitHub file paths reject absolute, traversal, and sensitive locations", () => {
  assert.equal(validateGitHubFilePath("server/routes.ts"), null);
  assert.equal(validateGitHubFilePath("client/src/pages/home.tsx"), null);

  for (const filePath of [
    "/etc/passwd",
    "C:/Users/admin/.ssh/id_rsa",
    "../outside.ts",
    "server/../secrets.ts",
    ".git/config",
    "credentials/oauth.json",
    "secrets/api.env",
    ".env",
    "node_modules/pkg/index.js",
  ]) {
    assert.notEqual(validateGitHubFilePath(filePath), null, filePath);
  }
});

test("GitHub commit messages are bounded and single-line", () => {
  assert.equal(validateGitHubCommitMessage("Update assistant guardrails"), null);
  assert.match(validateGitHubCommitMessage("tiny") || "", /corto/);
  assert.match(validateGitHubCommitMessage("Update file\n\nCo-authored-by: bad") || "", /multilinea/);
  assert.match(validateGitHubCommitMessage("x".repeat(201)) || "", /largo/);
});

test("GitHub issue titles and bodies are bounded before connector access", () => {
  assert.equal(validateGitHubIssueTitle("Create Codex PR-first handoff"), null);
  assert.match(validateGitHubIssueTitle("tiny") || "", /corto/);
  assert.match(validateGitHubIssueTitle("Bad\nTitle") || "", /multilinea/);
  assert.match(validateGitHubIssueTitle("x".repeat(201)) || "", /largo/);

  assert.equal(validateGitHubIssueBody("This issue body has enough detail for a safe handoff."), null);
  assert.match(validateGitHubIssueBody("too short") || "", /corto/);
  assert.match(validateGitHubIssueBody("x".repeat(64 * 1024 + 1)) || "", /grande/);
});

test("GitHub issue and PR numbers are bounded before connector access", () => {
  assert.equal(validateGitHubIssueNumber(12), null);
  assert.match(validateGitHubIssueNumber(0) || "", /invalido/);
  assert.match(validateGitHubIssueNumber(1.5) || "", /invalido/);
  assert.match(validateGitHubIssueNumber(1_000_001) || "", /invalido/);
});

test("GitHub pull request URLs are parsed only from safe GitHub pull links", () => {
  assert.deepEqual(parseGitHubPullRequestUrl("https://github.com/owner/repo/pull/12"), {
    owner: "owner",
    repo: "repo",
    repoFullName: "owner/repo",
    pullNumber: 12,
  });
  assert.deepEqual(parseGitHubPullRequestUrl("https://www.github.com/owner/repo.name-1/pull/99"), {
    owner: "owner",
    repo: "repo.name-1",
    repoFullName: "owner/repo.name-1",
    pullNumber: 99,
  });
  assert.equal(parseGitHubPullRequestUrl("https://github.com/owner/repo/issues/12"), null);
  assert.equal(parseGitHubPullRequestUrl("https://evil.example.com/owner/repo/pull/12"), null);
  assert.equal(parseGitHubPullRequestUrl("https://github.com/owner/repo/pull/0"), null);
  assert.equal(parseGitHubPullRequestUrl("https://github.com/owner/repo/name/pull/12"), null);
});

test("GitHub PR release status requires review approval on the current head", () => {
  const ready = summarizeGitHubPullRequestReleaseStatus(buildReleaseStatusInput());
  assert.equal(ready.readyForReleaseEvidence, true);
  assert.equal(ready.secondReviewEvidenceUrl, "https://github.com/owner/repo/pull/12#pullrequestreview-1");

  const staleApproval = summarizeGitHubPullRequestReleaseStatus(buildReleaseStatusInput({
    reviews: [{
      state: "APPROVED",
      commit_id: "oldsha",
      html_url: "https://github.com/owner/repo/pull/12#pullrequestreview-old",
      submitted_at: "2026-06-30T00:01:00Z",
      user: { login: "reviewer" },
    }],
  }));
  assert.equal(staleApproval.readyForReleaseEvidence, false);
  assert.match(staleApproval.blockers.join("\n"), /head actual/);
  assert.equal(staleApproval.secondReviewEvidenceUrl, "");
});

test("GitHub PR release status requires trusted App QA evidence tied to the current head", () => {
  const missingHead = summarizeGitHubPullRequestReleaseStatus(buildReleaseStatusInput({
    comments: [{
      body: "App QA passed. no blockers.",
      html_url: "https://github.com/owner/repo/pull/12#issuecomment-1",
      author_association: "OWNER",
      user: { login: "robert" },
    }],
  }));
  assert.equal(missingHead.readyForReleaseEvidence, false);
  assert.match(missingHead.blockers.join("\n"), /App QA pass para el PR head actual/);
  assert.equal(missingHead.appQaEvidenceUrl, "");

  const untrusted = summarizeGitHubPullRequestReleaseStatus(buildReleaseStatusInput({
    comments: [{
      body: "App QA passed for abc123def456. no blockers.",
      html_url: "https://github.com/owner/repo/pull/12#issuecomment-2",
      author_association: "NONE",
      user: { login: "drive-by" },
    }],
  }));
  assert.equal(untrusted.readyForReleaseEvidence, false);
  assert.match(untrusted.blockers.join("\n"), /App QA pass para el PR head actual/);
  assert.equal(untrusted.appQaEvidenceUrl, "");

  const fakeAppQaLogin = summarizeGitHubPullRequestReleaseStatus(buildReleaseStatusInput({
    comments: [{
      body: "App QA passed for abc123def456. no blockers.",
      html_url: "https://github.com/owner/repo/pull/12#issuecomment-3",
      author_association: "NONE",
      user: { login: "app-qa-fake" },
    }],
  }));
  assert.equal(fakeAppQaLogin.readyForReleaseEvidence, false);
  assert.match(fakeAppQaLogin.blockers.join("\n"), /App QA pass para el PR head actual/);
  assert.equal(fakeAppQaLogin.appQaEvidenceUrl, "");
});

test("GitHub PR release status requires App QA target fields when provided", () => {
  const genericComment = summarizeGitHubPullRequestReleaseStatus(buildReleaseStatusInput({
    appQaTargetEvidence: {
      workspaceId: "workspace-123",
      clientName: "Target Cafe",
      repoFullName: "owner/repo",
      branchName: "codex/client-build",
      routePath: "/revenue-engine",
    },
  }));
  assert.equal(genericComment.readyForReleaseEvidence, false);
  assert.match(genericComment.blockers.join("\n"), /target del workspace/);
  assert.equal(genericComment.appQaEvidenceUrl, "");

  const targetedComment = summarizeGitHubPullRequestReleaseStatus(buildReleaseStatusInput({
    comments: [{
      body: [
        "App QA passed for abc123def456. no blockers.",
        "",
        "App QA target: revenue_delivery_workspace",
        "Revenue workspace: workspace-123",
        "Client target: Target Cafe",
        "Repo target: owner/repo",
        "Branch target: codex/client-build",
        "PR head target: abc123def456",
        "Route target: /revenue-engine",
      ].join("\n"),
      html_url: "https://github.com/owner/repo/pull/12#issuecomment-targeted",
      author_association: "OWNER",
      user: { login: "robert" },
    }],
    appQaTargetEvidence: {
      workspaceId: "workspace-123",
      clientName: "Target Cafe",
      repoFullName: "owner/repo",
      branchName: "codex/client-build",
      routePath: "/revenue-engine",
    },
  }));
  assert.equal(targetedComment.readyForReleaseEvidence, true);
  assert.equal(targetedComment.appQaEvidenceUrl, "https://github.com/owner/repo/pull/12#issuecomment-targeted");
});

test("GitHub PR release status blocks pending checks and unverifiable check APIs", () => {
  const pendingChecks = summarizeGitHubPullRequestReleaseStatus(buildReleaseStatusInput({
    checksData: {
      check_runs: [{
        status: "in_progress",
        conclusion: null,
      }],
    },
  }));
  assert.equal(pendingChecks.readyForReleaseEvidence, false);
  assert.match(pendingChecks.blockers.join("\n"), /checks pendientes/);

  const apiFailure = summarizeGitHubPullRequestReleaseStatus(buildReleaseStatusInput({
    checksData: { check_runs: [] },
    statusesData: { state: "unknown", statuses: [] },
    checksUnavailable: true,
    statusesUnavailable: true,
  }));
  assert.equal(apiFailure.readyForReleaseEvidence, false);
  assert.match(apiFailure.blockers.join("\n"), /No se pudo verificar GitHub checks/);
  assert.match(apiFailure.blockers.join("\n"), /No se pudo verificar GitHub statuses/);
});

test("GitHub write input rejects oversized or unsafe writes before Octokit", () => {
  assert.equal(validateGitHubFileWriteInput({
    owner: "robert",
    repo: "asistente",
    path: "server/safe.ts",
    content: "export const ok = true;",
    message: "Update safe file",
  }), null);

  assert.match(validateGitHubFileWriteInput({
    owner: "robert",
    repo: "asistente",
    path: ".env",
    content: "SECRET=value",
    message: "Update env file",
  }) || "", /sensible|bloqueado/);

  assert.match(validateGitHubFileWriteInput({
    owner: "robert",
    repo: "asistente",
    path: "server/large.ts",
    content: "x".repeat(1024 * 1024 + 1),
    message: "Update large file",
  }) || "", /demasiado grande/);
});

test("GitHub mutations reject unsafe input with 400 before connector access", async () => {
  await assert.rejects(
    () => updateFile("robert", "asistente", ".env", "SECRET=value", "Update env file"),
    (error: any) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /sensible|bloqueado/);
      return true;
    },
  );

  await assert.rejects(
    () => deleteFile("robert", "asistente", "../outside.ts", "Delete outside", "abc123"),
    (error: any) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /traversal/);
      return true;
    },
  );

  await assert.rejects(
    () => createIssue("robert", "repo/name", "Create Codex PR-first handoff", "This body has enough detail for validation."),
    (error: any) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /Repo invalido/);
      return true;
    },
  );

  await assert.rejects(
    () => createIssueComment("robert", "asistente", -1, "This comment body has enough detail for validation."),
    (error: any) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /Issue\/PR number invalido/);
      return true;
    },
  );
});
