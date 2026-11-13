---
description: Use when Robert asks BlackOps to review a GitHub pull request, inspect agent-generated PR work, check a branch before merge, or produce a PR-ready review summary. Enforces AGENTS.md PR review, QA, security, and rollback standards.
allowed-tools: Read Grep Glob Bash
---

## Current Worktree

!`git status --short`

## Instructions

Follow `AGENTS.md` and `CLAUDE.md`. This skill is a focused PR review gate, not an implementation workflow.

Use it for:

- Reviewing an existing PR URL or PR number.
- Checking a branch before it is considered ready.
- Reviewing Codex, Claude, Gemma, or other agent-generated changes.
- Preparing Robert-facing PR review notes.

Do not merge, deploy, or push changes from this skill. If a fix is needed, hand off to `/pr-first-fix` on a separate branch.

## Review Workflow

1. Identify the target PR or branch. If unclear, ask for `owner/repo` and PR number.
2. Read `docs/codebase-map.md` before broad source exploration when this repo is the target.
3. Inspect the PR diff and changed files.
4. Check that the change follows the repo's PR-first, QA, security, and deployment rules.
5. Look for:
   - Bugs, regressions, missing edge cases, and broken assumptions.
   - Security issues, secret exposure, unsafe logging, or public exploit details.
   - Missing tests, weak verification, or skipped build/type checks.
   - Customer-visible UI/API behavior that needs App QA.
   - Deployment claims made without Robert approval.
   - Rollback notes that are missing or not credible.
6. Run targeted checks when available and safe. Prefer read-only review if dependencies, secrets, or production access are required.

## Output

Lead with findings, ordered by severity:

- **Critical**: must fix before merge.
- **Important**: should fix before merge or explicitly accept risk.
- **Minor**: cleanup or clarity improvement.

Then include:

- Checks run and evidence.
- QA notes or why QA was not applicable.
- Security/privacy notes.
- Rollback note.
- Deployment status: waiting for Robert approval, not deployed.
- Recommendation: approve, request changes, or needs follow-up.
