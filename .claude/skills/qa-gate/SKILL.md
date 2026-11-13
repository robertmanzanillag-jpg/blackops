---
description: Use before marking any code, config, production behavior, security, deployment, or customer-visible UI change as ready. Produces a compact release-gate report.
allowed-tools: Read Grep Glob Bash
---

## Current Worktree

!`git status --short`

## Package Scripts

!`node -e "const p=require('./package.json'); for (const [k,v] of Object.entries(p.scripts||{})) console.log(k+': '+v)"`

## Instructions

Act as the release gate, not the implementer. Verify the change against the request and repo rules.

Check:

- Diff scope: only intended files changed.
- Secrets safety: no `.env`, credentials, tokens, private keys, or sensitive logs.
- Tests: targeted test(s) for touched area, plus `npm run check` or `npm run build` when appropriate.
- UI work: route/link/click/API/error/improvement scouts should run or be explicitly marked not applicable.
- Security work: no exploit details in public PR/issue text.
- Deployment: never deploy; deployment waits for Robert approval.

If anything fails or is unverified, do not mark ready. Return what is blocking and the next fix.

Output:

- Verdict: pass, blocked, or needs follow-up.
- Evidence: commands/checks run and key result.
- QA notes.
- Risks.
- Rollback note.
