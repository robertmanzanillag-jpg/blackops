# Developer Autopilot Codex Runbook

Status: connected MVP implemented for web chat, Telegram, GitHub handoff issues, Codex PR-first repair, Claude independent review, App QA release gate, and Replit approval blocking.

## Goal

When Robert reports a bug, threat, security issue, or production problem from chat or Telegram, the assistant should route the work to Codex using the ChatGPT/Codex subscription, open a PR first, run an independent Claude review, run App QA, report back, and only deploy to Replit after explicit approval.

## Default Flow

1. Receive a request from web chat, Telegram, App QA, Cybersecurity Agent, or Health Monitor.
2. Identify the affected GitHub repo and app project.
3. Create a private/sanitized GitHub handoff issue with the Codex PR-first brief.
4. Delegate the fix to Codex with PR-first instructions.
5. Codex works on a separate branch and opens a PR.
6. Claude reviews the PR independently as a second pair of eyes.
7. Resolve any Claude blockers or document non-blocking risks.
8. Run the project checks plus App QA subagents.
9. If every QA gate passes, send Robert the PR summary.
10. Ask before Replit deploy.
11. Deploy only after Robert explicitly approves.

## Safety Rules

- PR first, never direct-to-main.
- Codex creates or repairs; Claude reviews independently before App QA.
- Use Claude through the signed-in Claude/Claude Code workflow when available. Do not add Anthropic API spend unless Robert explicitly asks.
- Replit deploy always requires explicit approval.
- Any App QA warning or failure blocks deployment.
- Security reports must avoid public exploit details and secrets.
- Agent code must not touch `.env`, `credentials/`, `secrets/`, `.git/`, `node_modules/`, tokens, keys, or recovery material.
- If the repo cannot be identified, ask Robert before creating a Codex task.

## Connected Entry Points

- Web chat: developer bug/security messages are routed to Developer Autopilot before the general model fallback.
- Telegram: developer bug/security messages are routed to Developer Autopilot before generic work agents.
- API: `POST /api/developer-autopilot/handoff` creates the GitHub handoff issue.
- API: `POST /api/developer-autopilot/qa-gate` runs App QA and returns the deploy gate.
- App QA: `POST /api/app-qa-agent/scan` can notify Telegram and includes GitHub Scout, route, link/click, API, error, and improvement subagents.

## Current Codex Handoff

The app does not spend OpenAI API credits for Codex. It creates a GitHub handoff issue that Robert can open with Codex/Codex Cloud under the signed-in ChatGPT subscription workflow. The issue instructs Codex to work on a branch, open a PR, request `@codex review` on the PR, run Claude as an independent reviewer, run checks, and leave Replit deployment blocked until Robert approves.

## Claude Second Review

Claude is the independent reviewer in the same Dev + GitHub office. Its job is not to race Codex or deploy code. It checks the Codex PR for:

- Whether the diff actually matches the bug/security brief.
- Regression risk and missing tests.
- Security, privacy, secret-handling, and public-disclosure concerns.
- Whether rollback is clear enough for Robert.
- Whether any App QA warning should block release.

Default sequence:

```text
Codex PR -> Claude independent review -> App QA release gate -> Robert approval -> optional Replit deploy
```

## Message Template

```text
Ya tengo el PR listo.

Repo: owner/repo
PR: https://github.com/owner/repo/pull/123
Tipo: bug/security/threat
Checks: pass/fail
App QA: pass/fail
Claude review: pass/blockers
Riesgos: ...
Rollback: ...

No voy a montar en Replit hasta que me digas explicitamente: "apruebo deploy en Replit".
```

## Deployment Gate

Deployment is allowed only when all are true:

- A pull request URL exists.
- Claude independent review is complete and any blockers are resolved or explicitly documented.
- App QA `failCount` is 0.
- App QA `warnCount` is 0.
- Every App QA subagent status is `pass`.
- Robert explicitly approved Replit deployment after seeing the PR/QA summary.
