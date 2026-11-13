---
description: Use for bug, threat, security, production-fix, or customer-visible repair work. Enforces branch, PR, QA gate, and rollback discipline.
allowed-tools: Read Grep Glob Bash
---

## Current Worktree

!`git status --short`

## Instructions

Follow the repo's `AGENTS.md` rules. This skill is intentionally small: it is a guardrail, not a framework.

Required workflow:

1. Identify the affected repo/project. If unclear, ask for `owner/repo`.
2. Create or use a non-main branch for the fix.
3. Inspect `docs/codebase-map.md` before broad exploration.
4. Make the smallest safe change.
5. Run targeted tests first, then broader checks when risk is higher.
6. Run the QA gate before calling the fix ready.
7. Open or prepare a PR before any merge.
8. Never deploy without explicit Robert approval.

For security issues:

- Avoid public exploit details.
- Do not print secrets, tokens, customer data, or private URLs.
- Prefer least-public handoff text.

Final PR-ready summary must include:

- What broke or what risk was found.
- What changed.
- Files changed.
- Tests/build checks run.
- QA summary.
- Risks.
- Rollback note.
- Deployment status: waiting for approval, not deployed.
