# Metricool Tracking Runbook

Status: daily Facebook analytics sync is wired for the Miami News and New York News brands. It remains fail-closed until the Metricool API credentials and both matching brands are available; X is intentionally disabled.

## Decision

Use Metricool as the main publishing and analytics bridge. We do not need direct TikTok, Meta/Instagram, or YouTube posting APIs for the first operating version.

Direct platform APIs stay optional for special cases only:

- Metricool cannot support a required publishing or analytics workflow.
- A platform review requires a custom flow not covered by Metricool.
- We need a product-specific feature outside Metricool.

Shopify is still needed for revenue, orders, product drafts, add-to-cart, profit, refunds, and checkout signals.
Google Drive and Canva are still useful for asset creation before posts are scheduled.

## Required Metricool Plan

Recommended: Starter with up to 10 brands.

Current app plan:

| Metricool brand | Networks to connect | Notes |
| --- | --- | --- |
| Black Room (Fiesta + Radio) | Instagram, TikTok | One shared brand for events, radio, flyers, promo videos, stories, links, and recaps. |
| Dropshipping 1 | TikTok, Instagram, YouTube, Pinterest | Organic validation plus Shopify/UTM learning. |
| Dropshipping 2 | TikTok, Instagram, YouTube, Pinterest | Separate niche, offer, or angle so analytics do not mix. |
| Kong | Instagram | WhatsApp, email, and event ops stay outside Metricool. |
| Sports Daily Clips | TikTok, Instagram, YouTube | Clips with rights gates before publishing. |
| Meme Radar | TikTok, Instagram, YouTube | YouTube is prepared in code; skip it if launch stays TikTok + Instagram only. |
| Streamer Pulse | TikTok, Instagram, YouTube | Clips with source allowlist and creator permission checks. |
| Winner Account 1 | TikTok, Instagram, YouTube | Reserved for the first new account based on performance data. |
| Winner Account 2 | TikTok, Instagram, YouTube | Reserved for the second new account based on performance data. |
| Winner Account 3 | TikTok, Instagram, YouTube | Reserved for the third new account based on performance data. |

Total: 10 brands and 29 social profiles if every prepared profile is connected.

## What Was Installed

- `server/metricool-tracking.ts`: source of truth for Metricool brands, networks, counts, credential readiness, and MCP client config template.
- `script/metricool-plan.ts`: local status command that prints plan and credential readiness without exposing token values.
- `tests/metricool-tracking.test.ts`: regression coverage for the current 10-brand/29-profile plan.
- `CEO_ASSISTANT_ENV.example`: Metricool env placeholders.
- `server/metricool-analytics-sync.ts`: owner-only daily Facebook analytics pull at 06:45 America/New_York, with deduplication, delivery-ledger matching, and fail-closed brand/credential checks.
- `server/automation-registry.ts`: active daily Metricool analytics sync automation; existing paused rows are reconciled to active on startup.

## Local Check

```bash
npm run metricool:plan
```

Expected before credentials:

- `readyForMcp: false`
- missing `METRICOOL_USER_TOKEN`
- missing `METRICOOL_USER_ID`
- recommended plan `starter_10_brands`

## Credential Setup

Do not paste secrets in chat.

Add these only through local ignored env or the deployment secret manager:

```env
METRICOOL_USER_TOKEN=...
METRICOOL_USER_ID=...
METRICOOL_MCP_URL=https://ai.metricool.com/mcp
METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH=true
```

Metricool's official MCP package can be attached to MCP clients with:

```json
{
  "mcpServers": {
    "mcp-metricool": {
      "command": "uvx",
      "args": ["--upgrade", "mcp-metricool"],
      "env": {
        "METRICOOL_USER_TOKEN": "<METRICOOL_USER_TOKEN>",
        "METRICOOL_USER_ID": "<METRICOOL_USER_ID>"
      }
    }
  }
}
```

## Operating Loop

1. Create/connect all Metricool brands.
2. Run `npm run metricool:plan`.
3. Verify Metricool MCP can list brands.
4. Keep publishing approval-required at first.
5. Pull analytics daily: owned posts, views, engagement, comments, clicks, and shares. Unmatched manual or third-party posts are skipped.
6. Join Dropshipping posts with Shopify/UTM metrics.
7. Let Marketing Command Center update winners, losers, next hooks, next schedule, and risk notes.

## Approval Rules

Allowed automatically:

- read analytics
- read scheduled posts
- calculate best posting windows
- draft captions, hooks, schedules, and reports
- recommend what to repeat, vary, pause, or test

Approval required:

- publish or schedule a live post
- edit a scheduled live post
- spend ad budget
- use third-party media
- contact people, suppliers, DJs, creators, or customers
