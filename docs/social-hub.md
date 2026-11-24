# BlackOps Social Hub (Metricool propio)

Goal: replace Metricool. One queue for all networks — Facebook, Instagram, Threads, TikTok, YouTube, X, LinkedIn, Reddit — fed by Robert, la fábrica and la oficina.

## Ownership (Claude ↔ Codex, avoid same-file edits)
| Area | Owner | Files |
|---|---|---|
| Queue core, approval gate, retries, best time | Claude | `server/social-hub/scheduler.ts`, `shared/social-hub.ts` |
| Network publishers | Claude | `server/social-hub/providers.ts` |
| HTTP API | Claude | `server/social-hub/routes.ts` |
| Factory/BlackRoom integration (replace `blackroom-metricool-bridge`, clippers → hub) | Codex | new `server/social-hub/factory-bridge.ts` + callers |
| Confirmation (receipts verified by re-reading the post) + dedup | Codex | new `server/social-hub/receipts.ts`, `dedup.ts` |
| Analytics collectors per network + summary | Claude | `server/social-hub/analytics.ts` |
| Inbox (comments/DMs) | open | new `server/social-hub/inbox/*` |
| OAuth "Conectar" for 8 networks, encrypted token store, auto-refresh | Claude | `server/social-hub/oauth.ts` |
| Drizzle tables `social_posts`, `social_metrics` (replace file store) | open | `shared/schema.ts` |
| UI panel (calendar, composer, approvals, analytics) | Codex | `client/src/components/social-hub/*` |
| X media upload, LinkedIn media | open | `providers.ts` — coordinate with Claude first |

## Queue contract
**Input** (`SocialPostInput`): `brand`, `caption`, `mediaKind` (`none|image|video|carousel`), `mediaUrls` (public URLs), `targets[]` (`network`, `accountId`, optional `caption`, `options` — `subreddit`/`title` for Reddit, `title` for YouTube, `privacy`), `publishAt` (ISO or `"best"`), `createdBy` (`robert` | `factory:<role>` | `office:<agent>`).

Agents call in-process: `queueAgentSocialPost("factory:clippers", input)`.

**States**: `draft → pending_approval → scheduled → publishing → published | partially_published | failed`, plus `cancelled`.
- `createdBy: "robert"` → `scheduled`. Agents → `pending_approval` unless brand is in `SOCIAL_HUB_AUTO_APPROVE_BRANDS`.
- `partially_published` can be re-run with `publishNow`; already-published targets are skipped (no double post).

**Receipts** (`results[]` per target): `network`, `accountId`, `status` (`pending|published|failed`), `externalId`, `url`, `error`, `attempts`. Retryable errors (429/5xx) retry up to 3 times; 4xx stop.

## Safety switches
- `SOCIAL_HUB_PUBLISHING_ENABLED=true` required for any external post (default off).
- `SOCIAL_HUB_SCHEDULER=on` starts the 1-minute runner.
- `SOCIAL_HUB_ACCOUNTS='[{"network":"instagram","accountId":"<ig_user_id>","tokenEnv":"IG_TOKEN_BR"}]'` — tokens live only in env/secrets.

## API (owner-only)
`GET /api/social-hub/networks` · `GET|POST /api/social-hub/posts` · `POST /api/social-hub/posts/:id/{approve,cancel,reschedule,publish-now}` · `GET /api/social-hub/analytics?days=30` → `{byNetwork, topPosts}` · `POST /api/social-hub/analytics/refresh` · `GET /api/social-hub/best-time?networks=tiktok,instagram`

## Platform approvals Robert must get (outside code)
Meta app review (`pages_manage_posts`, `instagram_content_publish`, `threads_content_publish`), TikTok Content Posting API audit (unaudited apps post private-only), YouTube Data API quota, X API paid tier for posting, LinkedIn Community Management API, Reddit API app.

## Conectar cuentas
Env per app: `SH_META_CLIENT_ID/SECRET` (FB+IG), `SH_THREADS_CLIENT_ID/SECRET`, `SH_TIKTOK_CLIENT_KEY/SECRET`, `SH_GOOGLE_CLIENT_ID/SECRET`, `SH_X_CLIENT_ID/SECRET`, `SH_LINKEDIN_CLIENT_ID/SECRET`, `SH_REDDIT_CLIENT_ID/SECRET`, plus `SOCIAL_HUB_PUBLIC_URL` and `SOCIAL_HUB_TOKEN_KEY`.
Redirect URI to register in every app: `<SOCIAL_HUB_PUBLIC_URL>/api/social-hub/oauth/callback`.
Open `/api/social-hub/oauth/start/<network>` logged in as Robert. One Meta login connects every Page and its Instagram. Tokens: `data/social-hub/tokens.enc` (AES-256-GCM, git-ignored).
