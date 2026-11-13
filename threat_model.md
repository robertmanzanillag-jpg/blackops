# Threat Model

## Scope and production assumptions
- Production scan only. Development-only fallback paths, mockup sandbox behavior, and test scaffolding are out of scope unless production reachability is shown.
- The deployed app is public on the internet, so unauthenticated and authenticated HTTP endpoints are reachable by external attackers.
- Assume `NODE_ENV=production` in production.
- Assume platform TLS is correctly terminated by Replit.
- Treat `ALLOW_DEV_USER_FALLBACK=false` as the intended production setting. Findings should not rely on dev fallback being enabled.

## Application summary
BlackOps Reminder is a public full-stack TypeScript app with a React frontend and an Express backend backed by PostgreSQL. The server exposes a large `/api` surface for tasks, calendar sync, assistant actions, finance, automations, Telegram, OAuth connectors, Clippers workflows, and code/GitHub tooling.

Several high-impact third-party integrations are effectively deployment-scoped rather than user-scoped when they use environment tokens or shared Replit connectors. Any route or assistant flow that reaches those integrations must be treated as owner-sensitive unless there is an explicit per-user ownership mapping.

## Primary trust boundaries
1. **Internet to Express API**: Public routes, authenticated routes, and OAuth/webhook callbacks.
2. **User account boundary**: Data and actions should stay isolated per authenticated user.
3. **Server to third-party integrations**: Google Calendar, Google Drive, Telegram, Shopify, Canva, Zoho, GitHub, and AI providers.
4. **Server to local filesystem / code tooling**: Highly sensitive but partially owner-gated.
5. **Assistant-to-action boundary**: Assistant-generated actions should require the right approval and ownership checks.

## High-value assets
- User tasks, weekly summaries, portfolio and finance data.
- Pending approvals, audit logs, and assistant memory/profile data.
- Google Calendar events and Google Drive contents reachable through connected tokens.
- Telegram bot configuration and delivery paths.
- Connected third-party OAuth tokens and shared connector capabilities.
- Private GitHub repository inventory and any write access available through the connected GitHub identity.

## Threat actors
- Unauthenticated internet attackers.
- Authenticated but low-privilege users on the public deployment.
- Users attempting cross-account access to shared integrations or data.
- Attackers attempting brute force or webhook flooding against public endpoints.

## Production attack surfaces
- `/api/auth/*`
- `/api/calendar/*`
- `/api/google-drive/*`
- `/api/assistant/*`
- `/api/pending-actions/*`
- `/api/telegram/*`
- `/api/clippers/*`
- `/api/code/*` and `/api/github/*` owner-only tooling routes
- Authenticated helper routes that indirectly call shared connectors, especially GitHub, Google, Shopify, and Clippers automation helpers

## Areas intentionally deprioritized for this scan
- Dev/test-only fallback behavior without evidence of production enablement.
- Unregistered dead-code routes unless mounted by the live app.
- Mockup sandbox behavior not deployed to production.

## Scan anchors for future scans
- Verify every public callback route has strong state / origin validation and is bound to the initiating user or owner session.
- Check that every authenticated route enforces per-user ownership, not just “any logged-in user”.
- Re-check shared integrations that use env tokens or global connectors for cross-account exposure.
- Re-check assistant and autopilot shortcuts for direct execution against shared third-party accounts.
- Re-check public auth flows for login CSRF or other account-confusion paths.
- Re-check public endpoints for expensive body parsing or similar pre-auth resource exhaustion before abuse controls run.
- Re-check owner-only tooling routes if auth/user-resolution logic changes.
