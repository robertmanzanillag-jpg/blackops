---
name: codebase-overview
description: Use the generated local codebase map before broad exploration in this repository. Trigger for repo questions, architecture questions, route/API lookup, test targeting, impact analysis, Claude/Codex token reduction, agent handoffs, onboarding, and any task where an agent might otherwise read many files. Refresh the map after major file moves, route changes, new tests, or new server/client modules.
---

# Codebase Overview

Use this skill to reduce token usage by starting from a local repo map instead of rereading the whole project. The map is generated locally and skips sensitive paths.

## Workflow

1. Read `docs/codebase-map.md` before broad searches.
2. If the task depends on current file layout and files changed recently, run `npm run codebase:map`.
3. Use the map to choose the smallest likely set of source files.
4. Read those source files directly before editing, reviewing, or making strong claims.
5. For Claude handoffs, include the relevant map section plus only the targeted files or diff, not the whole repo.

## Local Artifacts

- `script/codebase-map.ts` builds the local index from `git ls-files`.
- `docs/codebase-map.md` is the human-readable map for agents.
- `docs/codebase-map.json` is the structured graph-like inventory for scripts or future MCP/local-model use. Do not read or paste the whole JSON into a prompt; query it locally or use the Markdown map first.
- `npm run codebase:map` refreshes both outputs.

## Safety

The generator is local-only. It skips:

- `.env` and known data exports
- `credentials/`
- `secrets/`
- `.git/`, `node_modules/`, build outputs, and media-heavy folders
- files larger than the local indexing limit
- SQL files and filenames that look like dumps, backups, credentials, secrets, or tokens

Do not paste secrets into Claude/Codex prompts. Use the map as a router, not as the final source of truth.

## Handoff Pattern

When escalating to Claude or another reviewer, use this shape:

```text
Use docs/codebase-map.md as the repo overview. Relevant area:
[short copied section or file list]

Task:
[specific question]

Inspect only the current diff and these files unless you find a concrete reason to expand:
- file A
- file B
```

## Regeneration Triggers

Run `npm run codebase:map` after:

- adding/removing pages, routes, server modules, scripts, or tests
- large refactors or file moves
- changing package scripts
- before a major Claude review if the map is older than the current branch changes
