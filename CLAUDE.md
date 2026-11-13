# Claude Code Project Memory

This repo already has the source of truth for agent rules in `AGENTS.md`.
Read it before code, config, security, deployment, production, or customer-facing UI work.

## Operating Rules

- Keep the setup lean. Prefer one focused skill or subagent over a large swarm.
- Use `docs/codebase-map.md` before broad repo exploration, then inspect source files directly.
- Do not edit `.env`, secrets, credentials, private keys, OAuth tokens, recovery codes, `credentials/`, `secrets/`, `.git/`, or `node_modules/`.
- Bug, threat, security, and production fixes are PR-first. Never commit directly to `main` for agent-generated fixes.
- If BlackOps gives an existing PR number or GitHub PR link, it may dispatch Codex Cloud by commenting `@codex fix` on that PR through the signed-in Codex/GitHub integration. If no PR exists, create or request the PR-first handoff before expecting direct Codex repair.
- App QA is the release gate. If QA reports warnings or failures, do not deploy.
- Bug Patrol is allowed to create PR-first Codex handoff issues for new critical/high App QA findings when the affected app has a GitHub repo. It must not merge or deploy automatically.
- Replit deployment requires explicit Robert approval after the PR and QA summary.
- Security details should use the least-public channel available.

## Lean Claude Code Reinforcement

Use these project skills instead of installing a large framework by default:

- `/project-scout` before architecture lookup, route/API lookup, impact analysis, or test targeting.
- `/pr-first-fix` for bug, production, threat, or security repair work.
- `/review-pr` when Robert asks to review a pull request, inspect agent-generated PR work, or check a branch before merge.
- `/qa-gate` before saying a code/config/UI change is ready.
- `/skill-scout` only when a repeated workflow should become a new skill.
- `/marketing-autopilot` for ads, campaigns, creatives, hooks, offers, funnels, tracking, Metricool, captions, publishing queues, and marketing analysis.
- `/design-creative` for design, UI/UX, branding, Canva, flyers, landing pages, promo visuals, layouts, mockups, and visual QA.

The BlackOps web and Telegram assistants also read relevant local `.claude/skills/*/SKILL.md` files through `server/claude-skill-bridge.ts`. Keep marketing/design skill instructions concise because selected skill bodies are injected into chat prompts.
Token controls for the bridge:

- `BLACKOPS_SKILLS_MAX_ACTIVE` defaults to `1`.
- `BLACKOPS_SKILLS_MAX_BODY_CHARS` defaults to `900`.
- `BLACKOPS_SKILLS_MAX_CONTEXT_CHARS` defaults to `2500`.
- `BLACKOPS_SKILLS_MIN_SCORE` defaults to `8`.
- `BLACKOPS_SKILLS_CACHE_TTL_MS` defaults to `30000`.

When no skill matches the current message, the bridge injects no skill context.

## AI Cost Controls

BlackOps is configured to stay cheap-first by default so Robert can keep AI/API spend under the business target before scaling.

- `BLACKOPS_AI_MONTHLY_BUDGET_USD` defaults to `500`.
- `BLACKOPS_AI_OPERATING_TARGET_USD` defaults to `350`.
- `BLACKOPS_AI_HISTORY_MESSAGES` defaults to `8`.
- `BLACKOPS_OPENAI_MAX_COMPLETION_TOKENS` defaults to `900`.
- `BLACKOPS_WEB_CHEAP_SCOUT_ENABLED` defaults to enabled; set `false` to force the web chat fallback back to OpenAI.
- `BLACKOPS_WEB_CHEAP_SCOUT_MAX_MESSAGE_CHARS` defaults to `900` for short low-risk web chat fallback routing.
- `BLACKOPS_GEMINI_CHAT_MODEL` can override the Telegram/Gemini chat model. Without an override, Telegram text uses `gemini-2.5-flash-lite` and image analysis uses `gemini-2.5-flash`.
- `BLACKOPS_AI_MANUAL_MONTH_TO_DATE_USD` can add provider-dashboard AI usage into the dashboard monthly spend tracker.
- `BLACKOPS_METRICOOL_MONTHLY_USD` and `BLACKOPS_FIXED_MONTHLY_TOOLS_USD` add fixed subscription/tool costs into the same dashboard tracker.
- Use cheap scout work for summaries, captions, clustering, clip planning, first drafts, and low-risk web chat fallback. Use the strong model for final strategy, spend, production, security, code, or high-risk judgment.
- Strict cost mode is on by default. For heavy manual work, use the subscription handoff flow so Robert can run the deep work in signed-in ChatGPT/Codex Pro instead of BlackOps API spend.
- Subscription handoff is not a downgrade. It is the preferred strong-work path when the work can be done through Robert's memberships instead of app API calls.
- Keep cheap scout prompts compact and intent-routed. Use short-lived cache only for repeated low-risk creative drafts, not calendar, market, portfolio, safety, code, or money decisions.
- Do not trigger paid generative video at scale, paid ad spend, external posting, supplier/customer outreach, or production changes without Robert approval and a cost estimate.

Do not add new agents, hooks, MCP servers, dependencies, or automations unless they remove repeated work or enforce an existing safety rule.

## Completion Shape

For agent-generated PR-ready work, report:

- What broke or what risk was found.
- What changed.
- Files changed.
- Tests/build checks run.
- QA or reviewer summary.
- Risks and rollback note.
- Whether deployment is waiting for approval.
