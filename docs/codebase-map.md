# Codebase Map

Generated: 2026-11-07T04:45:37.459Z
Repo: `.`
Package: `rest-express`

## Guardrails
- Generated locally from Git-visible files only: tracked files plus untracked files that are not ignored.
- Skips credentials/, secrets/, .env files, node_modules/, build outputs, media folders, and large data exports.
- Does not index SQL files or filenames that look like dumps, backups, credentials, secrets, or tokens.
- Use this map to narrow exploration; verify behavior in source files before editing.

## Totals
| Git-visible files | Indexed files | Imports | Routes | Symbols |
| ---: | ---: | ---: | ---: | ---: |
| 1010 | 912 | 3440 | 571 | 18840 |

## Entrypoints
- `client/src/App.tsx`
- `client/src/main.tsx`
- `drizzle.config.ts`
- `package.json`
- `server/index.ts`
- `server/routes.ts`
- `shared/schema.ts`
- `vite.config.ts`

## Main Directories
| Directory | Visible | Indexed | Main kinds |
| --- | ---: | ---: | --- |
| `tests` | 259 | 255 | test:259 |
| `server` | 243 | 238 | server:243 |
| `script` | 104 | 93 | script:104 |
| `examples/clippers-motivation` | 71 | 71 | other:70, docs:1 |
| `client/src/components/ui` | 55 | 55 | ui-component:55 |
| `docs` | 54 | 52 | docs:54 |
| `client/src/components` | 30 | 30 | client-component:30 |
| `client/src/pages` | 26 | 24 | client-page:26 |
| `.` | 35 | 18 | other:23, docs:11, package:1 |
| `client/src/lib` | 18 | 18 | client-lib:18 |
| `shared` | 18 | 18 | shared:18 |
| `.agents/memory` | 5 | 5 | docs:5 |
| `client/src/components/company-office` | 5 | 5 | client-component:5 |
| `server/replit_integrations/chat` | 4 | 4 | server:4 |
| `client/src` | 3 | 3 | other:3 |
| `client/src/hooks` | 3 | 3 | client-hook:3 |
| `server/replit_integrations/image` | 3 | 3 | server:3 |
| `client/public` | 14 | 2 | other:14 |
| `client/src/components/agents-world-office` | 2 | 2 | client-component:2 |
| `server/replit_integrations/batch` | 2 | 2 | server:2 |
| `tests/fixtures` | 2 | 2 | test:2 |
| `.agents/skills/codebase-overview` | 1 | 1 | docs:1 |
| `client` | 1 | 1 | other:1 |
| `client/src/components/agents-building` | 1 | 1 | client-component:1 |

## Routes Detected
- `client/src/App.tsx`: `/`, `/agents-office`, `/app-qa-agent`, `/assistant`, `/automations`, `/ceo`, `/clippers`, `/code-agent`, `/cybersecurity-agent`, `/dashboard`, `/dropshipping-ceo`, `/github-agent`, `/legal-compliance`, `/marketing-command-center`, `/news`, `/news/article/:slug`, `/news/miami`, `/news/new-york`, `/portfolio`, `/portfolio/:symbol`, `/projects`, `/promo-video`, `/radio`, `/revenue-engine`, `/revenue-engine/advanced`, `/tools`
- `script/software-factory-office-ui-fixture.mjs`: `/api/agent-council/state`, `/api/agents-office/connections`, `/api/agents-office/kong-snapshot`, `/api/ceo/conversation-history`, `/api/legal-compliance/reports`, `/api/monthly-goals`
- `server/agent-council-routes.ts`: `/api/agent-company/orders`, `/api/agent-company/orders/:id/done`, `/api/agent-council/internal-work`, `/api/agent-council/run`, `/api/agent-council/state`
- `server/assistant.ts`: `/api/assistant/chat`, `/api/assistant/context`, `/api/assistant/transcribe`
- `server/blackroom-control-routes.ts`: `/api/blackroom-agent`, `/api/blackroom-agent/analytics/import`, `/api/blackroom-agent/analytics/refresh`, `/api/blackroom-agent/chat`, `/api/blackroom-agent/media/:reservationId`, `/api/blackroom-agent/media/chunked`, `/api/blackroom-agent/media/chunked/:uploadId/:index`, `/api/blackroom-agent/media/chunked/:uploadId/complete`, `/api/blackroom-agent/metricool/schedule`, `/api/blackroom-agent/pause`, `/api/blackroom-agent/remote`, `/api/blackroom-agent/start`, `/api/blackroom-agent/work-now`, `/blackroom`
- `server/index.ts`: `/clippers/legal/privacy`, `/clippers/legal/terms`, `/clippers/review-demo`, `/dropshipping/legal/checkout-readiness`, `/dropshipping/legal/privacy`, `/dropshipping/legal/refund-policy`, `/dropshipping/legal/shipping-policy`, `/dropshipping/legal/terms`, `/tiktokxXFfBZAFcOIGUKNMLUhs8E9M66NBKXCP.txt`, `/tiktokzjohuZmzXSsUwXRmI6fqM3JDKo7jsLUN.txt`
- `server/kong-operations-routes.ts`: `/api/kong-ops/cards`, `/api/kong-ops/lease`, `/api/kong-ops/metrics`, `/api/kong-ops/publications`, `/api/kong-ops/reconcile`, `/api/kong-ops/state`
- `server/kong-supervisor-routes.ts`: `/api/kong-supervisor/chat`, `/api/kong-supervisor/state`
- `server/local-auth.ts`: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/register`
- `server/marketing-learning-routes.ts`: `/api/marketing-command-center`, `/api/marketing-command-center/run-day`
- `server/office-business-routes.ts`: `/api/agents-office/${route.path}`
- `server/office-review-benchmarks.ts`: `/diagnostics`, `/notes`, `/profile`, `/projects/:id`, `/report`, `/users/:id`
- `server/office-routes.ts`: `/api/agents-office/cities`, `/api/agents-office/connections`, `/api/agents-office/contact-action`, `/api/agents-office/kong-snapshot`, `/api/agents-office/runs`
- `server/replit_integrations/chat/routes.ts`: `/api/conversations`, `/api/conversations/:id`, `/api/conversations/:id/messages`
- `server/replit_integrations/image/routes.ts`: `/api/generate-image`
- `server/revenue-stripe-routes.ts`: `/api/stripe/revenue-readiness`, `/api/stripe/revenue-webhook`
- `server/routes.ts`: `/api/agent/actions`, `/api/agent/actions/:category`, `/api/agent/execute-batch`, `/api/agent/execute/:actionId`, `/api/agent/history`, `/api/ai-spend/monthly`, `/api/app-qa-agent/history`, `/api/app-qa-agent/scan`, `/api/app-qa-agent/status`, `/api/approval-history`, `/api/assistant/permissions`, `/api/assistant/permissions/:scope`, `/api/audit-logs`, `/api/automation-manager/summary`, `/api/automation-runs`, `/api/automations`, `/api/automations/:id`, `/api/automations/:id/pause`, `/api/automations/:id/resume`, `/api/automations/:id/run`, `/api/automations/:id/runs`, `/api/calendar/events`, `/api/calendar/status`, `/api/calendar/sync`, `/api/calendar/zoho/sync`, `/api/canva/auth`, `/api/canva/oauth/callback`, `/api/canva/status`, `/api/ceo-dashboard`, `/api/ceo/commitments`, `/api/ceo/commitments/:id`, `/api/ceo/communication-drafts`, `/api/ceo/decisions`, `/api/ceo/decisions/:id`, `/api/ceo/follow-ups`, `/api/ceo/follow-ups/:id/complete`, `/api/ceo/meetings/:id/prep`, `/api/ceo/meetings/prep`, `/api/ceo/people`, `/api/ceo/people/:id`, `/api/clippers/account-permission-readiness`, `/api/clippers/apply-external-closeout-evidence-import`, `/api/clippers/apply-ready-external-closeout-evidence-import`, `/api/clippers/bootstrap-accounts`, `/api/clippers/bootstrap-workspace`, `/api/clippers/external-closeout-evidence-import`, `/api/clippers/external-closeout-next-action`, `/api/clippers/external-closeout-operator-queue`, `/api/clippers/external-closeout-pack`, `/api/clippers/external-closeout-proof-todo`, `/api/clippers/external-closeout-repair-work-packet`, `/api/clippers/external-next-work-run`, `/api/clippers/import-credential-drop-files`, `/api/clippers/import-launch-evidence-drop-files`, `/api/clippers/import-metricool-approval-evidence`, `/api/clippers/import-source-drop-files`, `/api/clippers/ingest-metrics`, `/api/clippers/ingest-trends`, `/api/clippers/local-news/bootstrap`, `/api/clippers/local-news/growth-scout`, `/api/clippers/local-news/growth-scout/run`, `/api/clippers/local-news/ingest-events`, `/api/clippers/local-news/record-metrics`, `/api/clippers/local-news/run-cycle`, `/api/clippers/local-news/status`, `/api/clippers/local-news/sync-metricool-analytics`, `/api/clippers/oauth/:platform/callback`, `/api/clippers/oauth/:platform/start`, `/api/clippers/operational-readiness`, `/api/clippers/prepare-100-clips-execution-sprint`, `/api/clippers/prepare-account-creation-pack`, `/api/clippers/prepare-account-evidence-vault`, `/api/clippers/prepare-account-identity-kit`, `/api/clippers/prepare-account-launch-kit`, `/api/clippers/prepare-account-permission-readiness`, `/api/clippers/prepare-account-setup-session`, `/api/clippers/prepare-analytics-reporting-pack`, `/api/clippers/prepare-app-review-demo-pack`, `/api/clippers/prepare-app-review-submission-pack`, `/api/clippers/prepare-automation-schedule`, `/api/clippers/prepare-blocker-resolution-pack`, `/api/clippers/prepare-command-center`, `/api/clippers/prepare-credential-doctor`, `/api/clippers/prepare-credential-drop-starter`, `/api/clippers/prepare-credential-setup`, `/api/clippers/prepare-developer-app-evidence-vault`, `/api/clippers/prepare-developer-application-drafts`, `/api/clippers/prepare-draft-specs`, `/api/clippers/prepare-drive-workspace`, `/api/clippers/prepare-dropzone-ready-pack`, `/api/clippers/prepare-external-account-permission-sprint`, `/api/clippers/prepare-external-closeout-pack`, `/api/clippers/prepare-external-connect-sprint`, `/api/clippers/prepare-external-execution-handoff`, `/api/clippers/prepare-external-execution-session`, `/api/clippers/prepare-external-launch-dossier`, `/api/clippers/prepare-external-next-work-run`, `/api/clippers/prepare-external-setup-queue`, `/api/clippers/prepare-go-live-autopilot-brief`, `/api/clippers/prepare-go-live-completion-audit`, `/api/clippers/prepare-go-live-evidence-bundle`, `/api/clippers/prepare-go-live-execution-pack`, `/api/clippers/prepare-go-live-operator-brief`, `/api/clippers/prepare-https-tunnel-plan`, `/api/clippers/prepare-intake-kit`, `/api/clippers/prepare-launch-evidence-fix-pack`, `/api/clippers/prepare-launch-lane-matrix`, `/api/clippers/prepare-legal-policy-pack`, `/api/clippers/prepare-manual-posting-pack`, `/api/clippers/prepare-metricool-approval-report`, `/api/clippers/prepare-metricool-approval-session`, `/api/clippers/prepare-metricool-execution-queue`, `/api/clippers/prepare-metricool-mvp-launch-pack`, `/api/clippers/prepare-metricool-publishing-plan`, `/api/clippers/prepare-oauth-connection-pack`, `/api/clippers/prepare-oauth-go-live`, `/api/clippers/prepare-official-permission-matrix`, `/api/clippers/prepare-official-permission-source-audit`, `/api/clippers/prepare-operational-readiness`, `/api/clippers/prepare-owner-connect-pack`, `/api/clippers/prepare-permission-request-pack`, `/api/clippers/prepare-permission-submission-dossier`, `/api/clippers/prepare-permission-tracker`, `/api/clippers/prepare-permissions`, `/api/clippers/prepare-platform-portal-checklist`, `/api/clippers/prepare-platform-readiness`, `/api/clippers/prepare-production-queue`, `/api/clippers/prepare-production-url-setup`, `/api/clippers/prepare-publisher-connectors`, `/api/clippers/prepare-publisher-execution-queue`, `/api/clippers/prepare-publishing-package`, `/api/clippers/prepare-rights-evidence-ledger`, `/api/clippers/prepare-rights-outreach`, `/api/clippers/prepare-robert-next-actions`, `/api/clippers/prepare-source-acquisition`, `/api/clippers/prepare-source-discovery-handoff`, `/api/clippers/prepare-source-hunt`, `/api/clippers/prepare-source-ingestion-sprint`, `/api/clippers/prepare-source-scout`, `/api/clippers/prepare-source-scout-daily-sprint`, `/api/clippers/prepare-source-scout-exact-url-kit`, `/api/clippers/prepare-source-scout-permission-pack`, `/api/clippers/prepare-source-scout-source-file-kit`, `/api/clippers/prepare-source-scout-work-queue`, `/api/clippers/prepare-source-supply-drop-kit`, `/api/clippers/prepare-trend-rights-outreach`, `/api/clippers/prepare-viral-discovery`, `/api/clippers/prepare-weekly-production-funnel`, `/api/clippers/preview-credential-secrets-batch`, `/api/clippers/preview-external-closeout-evidence-import`, `/api/clippers/preview-launch-evidence-batch`, `/api/clippers/record-account-evidence`, `/api/clippers/record-credential-secret`, `/api/clippers/record-credential-secrets-batch`, `/api/clippers/record-developer-app-evidence`, `/api/clippers/record-launch-evidence-batch`, `/api/clippers/record-metricool-account-evidence`, `/api/clippers/record-owner-connect-progress`, `/api/clippers/record-permission-status`, `/api/clippers/record-production-public-url`, `/api/clippers/record-source-intake-batch`, `/api/clippers/record-source-rights`, `/api/clippers/record-source-scout-intake`, `/api/clippers/record-trend-candidates-batch`, `/api/clippers/reload-credentials`, `/api/clippers/render-draft-videos`, `/api/clippers/reports/:id`, `/api/clippers/run-automation-cycle`, `/api/clippers/run-daily-plan`, `/api/clippers/run-external-connect-autopilot`, `/api/clippers/run-go-live-autopilot`, `/api/clippers/run-go-live-prep-sweep`, `/api/clippers/run-intake-refresh-sweep`, `/api/clippers/run-local-drop-sync`, `/api/clippers/run-post-connect-activation-sweep`, `/api/clippers/runtime-status`, `/api/clippers/status`, `/api/clippers/verify-production-local-preflight`, `/api/clippers/verify-production-url`, `/api/code/apply`, `/api/code/files`, `/api/code/generate`, `/api/code/history`, `/api/code/query`, `/api/code/read`, `/api/code/schema`, `/api/code/structure`, `/api/code/table`, `/api/code/table/:name`, `/api/code/table/:name/column`, `/api/code/template/:id`, `/api/code/templates`, `/api/code/undo`, `/api/code/write`, `/api/cybersecurity-agent/import-missing-apps`, `/api/cybersecurity-agent/scan`, `/api/cybersecurity-agent/status`, `/api/developer-autopilot/handoff`, `/api/developer-autopilot/qa-gate`, `/api/developer-health/apps`, `/api/developer-health/apps/:id/overview`, `/api/developer-health/apps/:id/timeline`, `/api/developer-health/dashboard`, `/api/developer-health/incidents`, `/api/developer-health/incidents/:id`, `/api/developer-health/incidents/:id/investigate`, `/api/djs`, `/api/djs/:id`, `/api/djs/:id/message`, `/api/dropshipping-ceo`, `/api/dropshipping-ceo/approval-decisions`, `/api/dropshipping-ceo/approval-outbox-migration`, `/api/dropshipping-ceo/autopilot-product-hunter`, `/api/dropshipping-ceo/capital-plan`, `/api/dropshipping-ceo/execution-setup`, `/api/dropshipping-ceo/fulfillment`, `/api/dropshipping-ceo/growth-sprint`, `/api/dropshipping-ceo/launch-pack`, `/api/dropshipping-ceo/launch-pack-approval-preview`, `/api/dropshipping-ceo/launch-pack-approvals`, `/api/dropshipping-ceo/launch-plan`, `/api/dropshipping-ceo/launch-readiness`, `/api/dropshipping-ceo/learning-review`, `/api/dropshipping-ceo/ledger`, `/api/dropshipping-ceo/live-signal-readiness`, `/api/dropshipping-ceo/marketing-campaign`, `/api/dropshipping-ceo/operating-cycle`, `/api/dropshipping-ceo/order`, `/api/dropshipping-ceo/pending-approval`, `/api/dropshipping-ceo/product-research`, `/api/dropshipping-ceo/product-scout-batch`, `/api/dropshipping-ceo/product-scout-candidate`, `/api/dropshipping-ceo/product-scout-promote`, `/api/dropshipping-ceo/report-preview`, `/api/dropshipping-ceo/run-cycle`, `/api/dropshipping-ceo/send-report`, `/api/dropshipping-ceo/shopify-draft`, `/api/dropshipping-ceo/shopify-preflight`, `/api/dropshipping-ceo/social-analysis`, `/api/dropshipping-ceo/social-metrics`, `/api/dropshipping-ceo/social-post-batch`, `/api/dropshipping-ceo/social-publish`, `/api/dropshipping-ceo/supplier-review`, `/api/finance/history/:symbol`, `/api/finance/market`, `/api/finance/news`, `/api/finance/news/:symbol`, `/api/finance/news/market`, `/api/finance/price/:symbol`, `/api/finance/search`, `/api/github/repos`, `/api/github/repos/:owner/:repo/contents`, `/api/github/repos/:owner/:repo/file`, `/api/github/status`, `/api/google-drive/auth`, `/api/google-drive/oauth/callback`, `/api/google-drive/organize`, `/api/google-drive/status`, `/api/investments`, `/api/investments/:id`, `/api/legal-compliance/reports`, `/api/monthly-goals`, `/api/monthly-goals/:id`, `/api/monthly-goals/all`, `/api/pending-actions`, `/api/pending-actions/:id`, `/api/pending-actions/:id/approve`, `/api/pending-actions/:id/cancel`, `/api/pending-actions/:id/edit`, `/api/pending-actions/:id/events`, `/api/pending-actions/:id/execute`, `/api/pending-actions/:id/reject`, `/api/pending-actions/:id/snooze`, `/api/portfolio/gains/:period`, `/api/portfolio/history`, `/api/portfolio/margin`, `/api/portfolio/opportunities`, `/api/portfolio/rebalance`, `/api/portfolio/send-report`, `/api/portfolio/summary`, `/api/portfolio/test-notification`, `/api/portfolio/weekly-report`, `/api/price-alerts`, `/api/price-alerts/:id`, `/api/projects`, `/api/projects/:id`, `/api/projects/:id/check`, `/api/projects/:id/incidents`, `/api/projects/:id/logs`, `/api/projects/github-overview`, `/api/projects/import-github`, `/api/promo-video/auto-daily`, `/api/promo-video/generate`, `/api/promo-video/import-source`, `/api/promo-video/output/:filename`, `/api/promo-video/preview-options`, `/api/promo-video/source`, `/api/promo-video/status`, `/api/public/local-news`, `/api/public/local-news/:slug`, `/api/push/subscribe`, `/api/push/test`, `/api/push/test-evening`, `/api/push/test-insights`, `/api/push/test-morning`, `/api/push/test-news`, `/api/push/test-weekly`, `/api/push/unsubscribe`, `/api/push/vapid-key`, `/api/radio/analysis`, `/api/radio/import-djs`, `/api/radio/notify-slots`, `/api/radio/slots`, `/api/radio/templates/assets`, `/api/radio/templates/generate-today`, `/api/revenue-engine`, `/api/revenue-engine/agent-runs`, `/api/revenue-engine/approval-decisions`, `/api/revenue-engine/assets/three.module.js`, `/api/revenue-engine/automation-agent-command`, `/api/revenue-engine/automation-intakes`, `/api/revenue-engine/automation-intakes/answer`, `/api/revenue-engine/automation-intakes/convert`, `/api/revenue-engine/automation-opportunities`, `/api/revenue-engine/automation-opportunities/close`, `/api/revenue-engine/automation-opportunities/delivery-workspace`, `/api/revenue-engine/automation-quote`, `/api/revenue-engine/daily-scout-sprint`, `/api/revenue-engine/daily-scout-sprint/submit`, `/api/revenue-engine/delivery-review`, `/api/revenue-engine/delivery-workspaces`, `/api/revenue-engine/delivery-workspaces/app-qa-gate`, `/api/revenue-engine/delivery-workspaces/deliver`, `/api/revenue-engine/delivery-workspaces/github-handoff`, `/api/revenue-engine/delivery-workspaces/improvement-review`, `/api/revenue-engine/delivery-workspaces/pr-status`, `/api/revenue-engine/delivery-workspaces/qa`, `/api/revenue-engine/delivery-workspaces/release-gate`, `/api/revenue-engine/delivery-workspaces/trusted-deliver`, `/api/revenue-engine/expense-preflight`, `/api/revenue-engine/improvement-review`, `/api/revenue-engine/launch-readiness`, `/api/revenue-engine/lead-radar`, `/api/revenue-engine/leads`, `/api/revenue-engine/ledger`, `/api/revenue-engine/mockup`, `/api/revenue-engine/mockup-previews/:slug`, `/api/revenue-engine/mockup-template-pack`, `/api/revenue-engine/money-sprint`, `/api/revenue-engine/money-sprint-preview`, `/api/revenue-engine/money-sprint/public-candidates`, `/api/revenue-engine/outreach-drafts`, `/api/revenue-engine/outreach-drafts/approve`, `/api/revenue-engine/outreach-drafts/update`, `/api/revenue-engine/outreach-outcome`, `/api/revenue-engine/outreach-send`, `/api/revenue-engine/plan`, `/api/revenue-engine/project-plan`, `/api/revenue-engine/proposal-email`, `/api/revenue-engine/public-lead-candidates`, `/api/revenue-engine/public-lead-candidates/approve`, `/api/revenue-engine/public-lead-candidates/batch`, `/api/revenue-engine/public-scout-agent-command`, `/api/revenue-engine/public-scout-connector-intake`, `/api/revenue-engine/public-scout-evidence`, `/api/revenue-engine/sales-autopilot`, `/api/revenue-engine/scout-dispatch`, `/api/revenue-engine/scouting-mission`, `/api/revenue-engine/website-delivery-workspace`, `/api/revenue-engine/website-opportunities`, `/api/revenue-engine/website-opportunities/close`, `/api/tasks`, `/api/tasks/:id`, `/api/tasks/by-title/:title`, `/api/tasks/deduplicate`, `/api/transactions`, `/api/watchlist`, `/api/watchlist/:id`, `/api/weekly-summaries`, `/api/weekly-summaries/:id`, `/api/weekly-summaries/:weekStart`, `/api/weekly-tasks`, `/api/weekly-tasks/:id`, `/api/yearly-goals`, `/api/yearly-goals/:id`, `/api/zoho/auth`, `/api/zoho/callback`, `/clippers/external-portal-launcher`, `/clippers/legal/privacy`, `/clippers/legal/terms`, `/clippers/review-demo`, `/news/article/:slug`
- `server/shopify-routes.ts`: `/api/shopify/install`, `/api/shopify/oauth/callback`, `/api/shopify/oauth/start`, `/api/shopify/oauth/status`
- `server/software-factory-routes.ts`: `/api/software-factory`, `/api/software-factory/budget`, `/api/software-factory/company-orders`, `/api/software-factory/pause`, `/api/software-factory/projects`
- `server/telegram-routes.ts`: `/api/ceo/conversation-history`, `/api/ceo/go-live`, `/api/ceo/go-live/evidence`, `/api/ceo/readiness`, `/api/telegram/configure`, `/api/telegram/disconnect`, `/api/telegram/health`, `/api/telegram/setup-webhook`, `/api/telegram/status`, `/api/telegram/test`, `/api/telegram/test-ceo-brief`, `/api/telegram/toggle`, `/api/telegram/webhook`, `/api/telegram/webhook-status`
- `tests/agents-office-local-qa.test.mjs`: `/api/agent-council/state`, `/api/agents-office/cities`, `/api/agents-office/connections`, `/api/agents-office/kong-snapshot`, `/api/app-qa-agent/status`, `/api/ceo/conversation-history`, `/api/ceo/go-live`, `/api/ceo/readiness`, `/api/fixture-owner-boundary`, `/api/github/repos`, `/api/github/repos/fixture/office-fixture/contents`, `/api/github/status`, `/api/legal-compliance/reports`, `/api/monthly-goals`, `/api/projects`, `/health`
- `tests/app-qa-agent.test.ts`: `([^`
- `tests/app-qa-status-readonly.test.mjs`: `/api/app-qa-agent/scan`, `/api/app-qa-agent/status`
- `tests/blackroom-remote-control.test.ts`: `/api/blackroom-agent`, `/api/blackroom-agent/analytics/import`, `/api/blackroom-agent/pause`, `/api/blackroom-agent/start`, `/api/blackroom-agent/work-now`, `/blackroom`
- `tests/clippers-owned-source-scripts.test.ts`: `/api/clippers/external-closeout-next-action`, `/api/clippers/external-closeout-operator-queue`, `/api/clippers/external-closeout-pack`, `/api/clippers/external-closeout-proof-todo`, `/api/clippers/external-closeout-repair-work-packet`, `/api/clippers/operational-readiness`, `/api/clippers/prepare-external-closeout-pack`, `/api/clippers/prepare-operational-readiness`, `/api/clippers/run-intake-refresh-sweep`, `/api/clippers/run-post-connect-activation-sweep`
- `tests/developer-autopilot-wiring.test.ts`: `/api/revenue-engine/delivery-workspaces/app-qa-gate`, `/api/revenue-engine/delivery-workspaces/github-handoff`, `/api/revenue-engine/delivery-workspaces/pr-status`, `/api/revenue-engine/delivery-workspaces/release-gate`
- `tests/harness/agents-world-integrated.tsx`: `/agents-office`
- `tests/kong-office-browser-qa.test.mjs`: `/api/agent-council/state`, `/api/agents-office/cities`, `/api/agents-office/connections`, `/api/agents-office/kong-snapshot`, `/api/app-qa-agent/status`, `/api/ceo/conversation-history`, `/api/ceo/go-live`, `/api/ceo/readiness`, `/api/fixture-owner-boundary`, `/api/github/repos`, `/api/github/repos/fixture/office-fixture/contents`, `/api/github/status`, `/api/legal-compliance/reports`, `/api/monthly-goals`, `/api/projects`, `/health`
- `tests/software-factory-panel.test.mjs`: `/`, `/api/software-factory`, `/api/software-factory/:action`, `/panel.js`

## Test Inventory
- `tests/._dropshipping-ceo.test.ts`
- `tests/._radio-youtube-command.test.ts`
- `tests/._rate-limit.test.ts`
- `tests/._user-context.test.ts`
- `tests/agent-company.test.ts`
- `tests/agent-council-owner.test.ts`
- `tests/agent-council-store.test.ts`
- `tests/agent-council.test.ts`
- `tests/agent-live-status.test.ts`
- `tests/agents-world-integration.test.ts`
- `tests/ai-cost-notifications.test.ts`
- `tests/ai-router-cost-override.test.ts`
- `tests/app-qa-agent.test.ts`
- `tests/app-qa-health-probe.test.ts`
- `tests/assistant-chat-flow.test.ts`
- `tests/automation-registry.test.ts`
- `tests/background-scheduler-policy.test.ts`
- `tests/blackroom-chat.test.ts`
- `tests/blackroom-content-agent.test.ts`
- `tests/blackroom-daily-queue.test.ts`
- `tests/blackroom-deterministic-editor.integration.test.ts`
- `tests/blackroom-deterministic-editor.test.ts`
- `tests/blackroom-growth-ceo.test.ts`
- `tests/blackroom-learning-observations.test.ts`
- `tests/blackroom-learning-panel.test.ts`
- `tests/blackroom-links.test.ts`
- `tests/blackroom-local-evidence.test.ts`
- `tests/blackroom-local-worker.test.ts`
- `tests/blackroom-manual-exploration.test.ts`
- `tests/blackroom-manual-observations.test.ts`
- `tests/blackroom-metricool-bridge.test.ts`
- `tests/blackroom-office-operations.test.ts`
- `tests/blackroom-remote-control.test.ts`
- `tests/blackroom-verified-learning.test.ts`
- `tests/ceo-backup-check-cli.test.ts`
- `tests/ceo-brief-cli.test.ts`
- `tests/ceo-briefing.test.ts`
- `tests/ceo-conversation-history.test.ts`
- `tests/ceo-db-check-cli.test.ts`
- `tests/ceo-doctor-cli.test.ts`
- `tests/ceo-go-live-cli.test.ts`
- `tests/ceo-operability.test.ts`
- `tests/ceo-operational-health.test.ts`
- `tests/ceo-ownership.test.ts`
- `tests/ceo-readiness-cli.test.ts`
- `tests/ceo-readiness.test.ts`
- `tests/ceo-smoke-cli.test.ts`
- `tests/client-auth-state.test.ts`
- `tests/clipper-observed-status.test.ts`
- `tests/clippers-agent.test.ts`
- `tests/clippers-local-news-agent.test.ts`
- `tests/clippers-local-news-growth.test.ts`
- `tests/clippers-local-news-metricool.test.ts`
- `tests/clippers-local-news-routes.test.ts`
- `tests/clippers-local-news-scheduler.test.ts`
- `tests/clippers-local-news-state-retention.test.ts`
- `tests/clippers-local-news-translation.test.ts`
- `tests/clippers-owned-source-scripts.test.ts`
- `tests/clippers-runtime-status.test.ts`
- `tests/clippers-upload-metricool-media.test.ts`
- `tests/clippers-youtube-audit-pages.test.ts`
- `tests/code-agent-security.test.ts`
- `tests/company-office-simulation.test.ts`
- `tests/cybersecurity-agent.test.ts`
- `tests/db-config.test.ts`
- `tests/developer-autopilot-wiring.test.ts`
- `tests/developer-autopilot.test.ts`
- `tests/developer-health-inventory.test.ts`
- `tests/dropshipping-ceo.test.ts`
- `tests/env-loader-core.test.ts`
- `tests/github-client-security.test.ts`
- `tests/google-connector.test.ts`
- `tests/google-drive-folder-command.test.ts`
- `tests/google-drive-oauth.test.ts`
- `tests/kong-company-routes.test.ts`
- `tests/kong-company.test.ts`
- `tests/kong-office-wing.test.ts`
- `tests/kong-operations-routes.test.ts`
- `tests/kong-operations.test.ts`
- `tests/legacy-publication-containment.test.ts`
- `tests/legal-compliance-agent.test.ts`
- `tests/local-auth-cli.test.ts`
- `tests/local-auth.test.ts`
- `tests/local-news-delivery-safety.test.ts`
- `tests/local-news-growth-scout.test.ts`
- `tests/local-news-source-diagnostics.test.ts`
- `tests/local-youtube-queue.test.ts`
- `tests/local-youtube-worker-queue.test.ts`
- `tests/marketing-command-center.test.ts`
- `tests/marketing-learning-routes.test.ts`
- `tests/marketing-learning-store.test.ts`
- `tests/metricool-analytics-sync.test.ts`
- `tests/metricool-tracking.test.ts`
- `tests/office-academy-benchmarks.test.ts`
- `tests/office-academy-promotion.test.ts`
- `tests/office-academy-runner.test.ts`
- `tests/office-business-routes.test.ts`
- `tests/office-business-work.test.ts`
- `tests/office-capability-lifecycle.test.ts`
- `tests/office-capability-training.test.ts`
- `tests/office-career-reconciliation.test.ts`
- `tests/office-city-agents.test.ts`
- `tests/office-claude.test.ts`
- `tests/office-cloud-runtime.test.ts`
- `tests/office-cloud-store.test.ts`
- `tests/office-council-migration.test.ts`
- `tests/office-editorial-scheduler.test.ts`
- `tests/office-editorial-work.test.ts`
- `tests/office-execution.test.ts`
- `tests/office-github.test.ts`
- `tests/office-internal-work.test.ts`
- `tests/office-kong-central-agents.test.ts`
- `tests/office-kong-collaboration.test.ts`
- `tests/office-kong-supervisor.test.ts`
- `tests/office-kong.test.ts`
- `tests/office-openai.test.ts`
- `tests/office-protocol.test.ts`
- `tests/office-radio-training.test.ts`
- `tests/office-revenue-work.test.ts`
- `tests/office-review-benchmarks.test.ts`
- `tests/office-role-academy-integration.test.ts`
- `tests/office-role-academy.test.ts`
- `tests/office-role-audits.test.ts`
- `tests/office-role-curricula.test.ts`
- `tests/office-role-lifecycle.test.ts`
- `tests/office-role-snapshots.test.ts`
- `tests/office-role-work.test.ts`
- `tests/office-routes.test.ts`
- `tests/office-runtime.test.ts`
- `tests/office-shared-credits.test.ts`
- `tests/office-token-budget.test.ts`
- `tests/office-training-receipts.test.ts`
- `tests/office-web-role-sources.test.ts`
- `tests/office-web-role-store.test.ts`
- `tests/office-web-source-scheduler.test.ts`
- `tests/office-worker-capabilities.test.ts`
- `tests/office-worker-watchdog.test.ts`
- `tests/owner-office-storage.test.ts`
- `tests/public-local-news.test.ts`
- `tests/radio-slot-policies.test.ts`
- `tests/radio-slots.test.ts`
- `tests/radio-template-agent.test.ts`
- `tests/radio-video-edit-agent.test.ts`
- `tests/radio-youtube-command.test.ts`
- `tests/rate-limit.test.ts`
- `tests/reminder-scheduler.test.ts`
- `tests/revenue-engine-delivery-qa.test.ts`
- `tests/revenue-engine-money-readiness-cli.test.ts`
- `tests/revenue-engine-public-scout-connector.test.ts`
- `tests/revenue-engine-state-store.test.ts`
- `tests/revenue-engine.test.ts`
- `tests/revenue-stripe.test.ts`
- `tests/session-config.test.ts`
- `tests/shared-openai-credit-ledger.test.ts`
- `tests/shared-openai-credit-store.test.ts`
- `tests/shopify-oauth.test.ts`
- `tests/software-factory-actions.test.ts`
- `tests/software-factory-asistente-build.test.ts`
- `tests/software-factory-asistente-operator.test.ts`
- `tests/software-factory-asistente-review.test.ts`
- `tests/software-factory-asistente-source.test.ts`
- `tests/software-factory-asistente-success.test.ts`
- `tests/software-factory-build-recovery.test.ts`
- `tests/software-factory-builder.test.ts`
- `tests/software-factory-company-scheduler.test.ts`
- `tests/software-factory-company.test.ts`
- `tests/software-factory-encrypted-state.test.ts`
- `tests/software-factory-gcs.test.ts`
- `tests/software-factory-github-client.test.ts`
- `tests/software-factory-github-publisher.test.ts`
- `tests/software-factory-github-state.test.ts`
- `tests/software-factory-github-transport.test.ts`
- `tests/software-factory-github.test.ts`
- `tests/software-factory-loop.test.ts`
- `tests/software-factory-object-store.test.ts`
- `tests/software-factory-office-connection.test.ts`
- `tests/software-factory-office-mode.test.ts`
- `tests/software-factory-office-ui-artifact.test.ts`
- `tests/software-factory-office-ui-evidence.test.ts`
- `tests/software-factory-once.test.ts`
- `tests/software-factory-openai-builder.test.ts`
- `tests/software-factory-openai-transport.test.ts`
- `tests/software-factory-openai.test.ts`
- `tests/software-factory-order-evidence.test.ts`
- `tests/software-factory-pilot-review.test.ts`
- `tests/software-factory-pipeline.test.ts`
- `tests/software-factory-postgres.test.ts`
- `tests/software-factory-proposal-runtime.test.ts`
- `tests/software-factory-remote-builder.test.ts`
- `tests/software-factory-role-acceptance.test.ts`
- `tests/software-factory-role-deadline.test.ts`
- `tests/software-factory-routes.test.ts`
- `tests/software-factory-runtime.test.ts`
- `tests/software-factory-simulator.test.ts`
- `tests/software-factory-store-provider.test.ts`
- `tests/software-factory-store.test.ts`
- `tests/software-factory-worker.test.ts`
- `tests/software-factory.test.ts`
- `tests/telegram-chat-flow.test.ts`
- `tests/telegram-chat-handler.test.ts`
- `tests/telegram-command.test.ts`
- `tests/telegram-config-cli.test.ts`
- `tests/telegram-readiness.test.ts`
- `tests/telegram-split.test.ts`
- `tests/telegram-webhook-cli.test.ts`
- `tests/telegram-webhook-dedupe.test.ts`
- `tests/telegram-webhook-runtime.test.ts`
- `tests/user-context.test.ts`
- `tests/user-migration-plan.test.ts`
- `tests/whatsapp-backend-consumer.test.ts`
- `tests/whatsapp-pr330.test.ts`

## Key Files
- `client/src/pages/._assistant.tsx` (client-page)
- `client/src/pages/._dropshipping-ceo.tsx` (client-page)
- `client/src/pages/agents-office.tsx` (client-page; 168 symbols, 18 imports)
- `client/src/pages/app-qa-agent.tsx` (client-page; 12 symbols, 9 imports)
- `client/src/pages/assistant.tsx` (client-page; 49 symbols, 7 imports)
- `client/src/pages/auth.tsx` (client-page; 6 symbols, 8 imports)
- `client/src/pages/automation-manager.tsx` (client-page; 13 symbols, 8 imports)
- `client/src/pages/ceo-dashboard.tsx` (client-page; 40 symbols, 10 imports)
- `client/src/pages/code-agent.tsx` (client-page; 21 symbols, 7 imports)
- `client/src/pages/cybersecurity-agent.tsx` (client-page; 11 symbols, 8 imports)
- `client/src/pages/dashboard.tsx` (client-page; 25 symbols, 26 imports)
- `client/src/pages/dropshipping-ceo.tsx` (client-page; 76 symbols, 13 imports)
- `client/src/pages/github-agent.tsx` (client-page; 32 symbols, 9 imports)
- `client/src/pages/investment-detail.tsx` (client-page; 41 symbols, 9 imports)
- `client/src/pages/legal-compliance.tsx` (client-page; 5 symbols, 7 imports)
- `client/src/pages/local-news-public.tsx` (client-page; 73 symbols, 4 imports)
- `client/src/pages/marketing-command-center.tsx` (client-page; 15 symbols, 10 imports)
- `client/src/pages/not-found.tsx` (client-page; 2 imports)
- `client/src/pages/portfolio.tsx` (client-page; 35 symbols, 14 imports)
- `client/src/pages/projects.tsx` (client-page; 14 symbols, 15 imports)
- `client/src/pages/promo-video.tsx` (client-page; 22 symbols, 11 imports)
- `client/src/pages/radio.tsx` (client-page; 19 symbols, 12 imports)
- `client/src/pages/revenue-engine-simple.tsx` (client-page; 33 symbols, 7 imports)
- `client/src/pages/tools.tsx` (client-page; 2 symbols, 6 imports)
- `package.json` (package)
- `script/blackroom-control-server.mjs` (script; 82 symbols, 11 imports)
- `script/blackroom-daily-agent.ts` (script; 16 symbols, 2 imports)
- `script/blackroom-deterministic-editor.ts` (script; 60 symbols, 8 imports)
- `script/blackroom-local-evidence.ts` (script; 30 symbols, 10 imports)
- `script/blackroom-local-worker.ts` (script; 73 symbols, 7 imports)
- `script/blackroom-metricool-csv-bridge.mjs` (script; 38 symbols)
- `script/blackroom-metricool-exporter.mjs` (script; 42 symbols, 7 imports)
- `script/blackroom-publication-collector.ts` (script; 12 symbols, 1 imports)
- `script/blackroom-remote-sync.mjs` (script; 24 symbols)
- `script/blackroom-worker-ledger.ts` (script; 29 symbols, 4 imports)
- `script/build-agents-world-client.mjs` (script; 4 imports)
- `script/build-containment-static.mjs` (script; 7 symbols, 5 imports)
- `script/build.ts` (script; 12 symbols, 6 imports)
- `script/cache-local-news-models.mjs` (script; 1 symbols)
- `script/ceo-db-check.ts` (script; 8 symbols, 3 imports)
- `script/ceo-doctor.ts` (script; 3 symbols, 1 imports)
- `script/ceo-go-live.ts` (script; 9 symbols, 2 imports)
- `script/ceo-handoff.mjs` (script; 1 imports)
- `script/ceo-readiness.ts` (script; 10 symbols, 8 imports)
- `script/ceo-restore.ts` (script; 9 symbols, 4 imports)
- `script/ceo-smoke.ts` (script; 29 symbols, 15 imports)
- `script/ceo-verify-local.mjs` (script; 2 symbols, 1 imports)
- `script/clippers-account-permission-readiness.mjs` (script; 82 symbols, 2 imports)
- `script/clippers-cleanup-published-vyro-media.mjs` (script; 47 symbols, 4 imports)
- `script/clippers-content-learning-ceo.mjs` (script; 85 symbols, 3 imports)
- `script/clippers-content-local-worker.mjs` (script; 112 symbols, 10 imports)
- `script/clippers-daily-watchdog.mjs` (script; 86 symbols, 3 imports)
- `script/clippers-external-closeout-pack.mjs` (script; 249 symbols, 3 imports)
- `script/clippers-free-local-worker.mjs` (script; 41 symbols, 5 imports)
- `script/clippers-generate-owned-gap-sources.mjs` (script; 30 symbols, 3 imports)
- `script/clippers-generate-owned-meme-sources.ts` (script; 23 symbols, 3 imports)
- `script/clippers-generate-owned-sports-streamer-sources.ts` (script; 26 symbols, 3 imports)
- `script/clippers-generate-owned-weekly-backlog-sources.ts` (script; 34 symbols, 3 imports)
- `script/clippers-import-external-closeout-evidence.ts` (script; 117 symbols, 3 imports)
- `script/clippers-local-subtitles.mjs` (script; 47 symbols, 5 imports)
- `script/clippers-marketplace-intake.mjs` (script; 59 symbols, 3 imports)
- `script/clippers-marketplace-refresh.mjs` (script; 50 symbols, 4 imports)
- `script/clippers-metricool-autopilot.mjs` (script; 116 symbols, 4 imports)
- `script/clippers-motivation-shorts.mjs` (script; 157 symbols, 6 imports)
- `script/clippers-operational-readiness.mjs` (script; 51 symbols, 4 imports)
- `script/clippers-prepare-vyro-campaign-drafts.mjs` (script; 23 symbols, 4 imports)
- `script/clippers-reconcile-publications.mjs` (script; 74 symbols, 3 imports)
- `script/clippers-record-owned-meme-rights.ts` (script; 10 symbols, 1 imports)
- `script/clippers-record-owned-source-rights.mjs` (script; 88 symbols, 3 imports)
- `script/clippers-render-campaign-drafts.mjs` (script; 118 symbols, 6 imports)
- `script/clippers-selected-env.mjs` (script; 11 symbols, 2 imports)
- `script/clippers-sleep-video-generator.mjs` (script; 93 symbols, 6 imports)
- `script/clippers-streamer-growth-ceo.mjs` (script; 170 symbols, 5 imports)
- `script/clippers-sync-metricool-source-readiness.mjs` (script; 28 symbols, 3 imports)
- `script/clippers-tiktok-preflight.ts` (script; 15 symbols, 1 imports)
- `script/clippers-upload-metricool-media.ts` (script; 51 symbols, 7 imports)
- `script/clippers-youtube-delivery-worker.mjs` (script; 30 symbols, 6 imports)
- `script/clippers-youtube-oauth-bootstrap.mjs` (script; 75 symbols, 6 imports)
- `script/clippers-youtube-publish-worker.mjs` (script; 105 symbols, 6 imports)
- `script/clippers-youtube-upload-packager.mjs` (script; 135 symbols, 7 imports)

## How Agents Should Use This
1. Read this map before broad repo exploration.
2. Pick the smallest set of files likely to answer the task.
3. Read source files directly before editing or making strong claims.
4. Regenerate with `npm run codebase:map` after major file moves, new pages, routes, tests, or server modules.
5. Do not paste `docs/codebase-map.json` into prompts; use it for local scripts or targeted lookups only.

