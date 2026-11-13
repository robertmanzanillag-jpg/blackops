---
description: Use before broad repo exploration, architecture questions, route/API lookup, impact analysis, test targeting, or handoffs. Reads the local codebase map first and keeps exploration small.
allowed-tools: Read Grep Glob Bash
---

## Repo Map

!`sed -n '1,260p' docs/codebase-map.md`

## Current Worktree

!`git status --short`

## Instructions

Use the map only as a router. Pick the smallest likely files, read those files directly, and avoid scanning unrelated areas.

When answering or planning:

- Name the relevant files and routes.
- Separate known facts from assumptions.
- Do not touch unrelated dirty worktree files.
- If source files moved, routes changed, tests changed, or server/client modules were added, recommend `npm run codebase:map` after the change.

Return a concise scout brief with:

- Relevant area.
- Files to inspect.
- Likely tests/checks.
- Risks or unknowns.
