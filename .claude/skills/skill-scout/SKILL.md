---
description: Use when a workflow repeats and Robert asks whether to add a Claude Code skill, subagent, hook, or Ruflo-style capability. Keeps the setup lean and rejects unnecessary additions.
allowed-tools: Read Grep Glob Bash
---

## Existing Claude Setup

!`find .claude -maxdepth 3 -type f 2>/dev/null | sort`

## Instructions

Recommend new Claude Code reinforcement only when it passes at least one test:

- It prevents a real repeated mistake.
- It shortens a repeated workflow.
- It enforces an existing approval, QA, security, or PR-first rule.
- It captures knowledge that would otherwise be pasted repeatedly.

Prefer this order:

1. Update an existing skill.
2. Add one small skill.
3. Add one focused read-only subagent.
4. Add hooks only for hard safety gates.
5. Add MCP/Ruflo-style orchestration only if the workflow is already proven and repeated.

Avoid:

- Large agent swarms by default.
- Generic agents with overlapping jobs.
- New dependencies for prompt-only workflows.
- Background automation without explicit approval.
- Cost-routing claims that are not measured locally.

Return:

- Keep as-is, update existing skill, or add new capability.
- The smallest useful change.
- What not to add.
- How to verify it worked.
