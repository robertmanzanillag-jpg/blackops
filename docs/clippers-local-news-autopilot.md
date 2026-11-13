# Clippers Local News Autopilot

## Objective

Run two local information lanes inside Clippers:

- `miami-news`: Miami and South Florida traffic, closures, transit, weather, and official alerts.
- `ny-news`: New York City traffic, closures, transit, weather, and official alerts.

Each verified event produces platform-specific drafts for X and Facebook. The system tracks updates and clearances as the same event instead of creating duplicate stories.

## Safety and rights model

The agent republishes facts from approved official feeds using original copy. It does not copy news articles, third-party photographs, broadcast footage, social videos, or protected graphics.

Low-risk operational information can enter the automatic queue:

- road closures and reopenings;
- congestion and delays;
- scheduled construction;
- transit disruptions;
- official weather alerts;
- public-event traffic impacts.

Events involving deaths, named victims, arrests, accusations, minors, active violence, or unverified social reports require human review. A source URL and retrieval timestamp are mandatory for every queue item.

## Processing flow

1. Poll enabled official sources every 2–5 minutes.
2. Normalize source payloads into the common local-news event schema.
3. Filter events into the Miami or New York lane.
4. Generate a stable fingerprint and merge duplicate reports.
5. Detect material updates, including a closure becoming cleared.
6. Apply the source, rights, confidence, and sensitive-content gates.
7. Generate separate X and Facebook copy.
8. Write the Metricool-ready queue and delivery ledger.
9. Schedule eligible low/medium-risk posts through Metricool's official API; keep sensitive items in review.
10. Import observed platform metrics and money without treating queued items as published.
11. Produce operating and analytics reports by city, platform, source, and event type.

## Source coverage

The public National Weather Service connector does not require an API key. Higher-coverage road data remains source-specific:

- 511NY requires a developer account, API key, and acceptance of the NYSDOT developer agreement.
- Florida road-event coverage uses an approved FL511/FDOT feed URL when available.
- The intake endpoint accepts signed or operator-controlled official-feed payloads from future connectors without changing the downstream pipeline.

The status report must distinguish `active`, `optional_unconfigured`, and `blocked` sources. It must never claim complete traffic coverage when a regional road feed is not configured.

## Metricool handoff

Two reserved Metricool brands are repurposed so the plan remains at ten brands:

- `Miami News` → Facebook Page + X account. The existing Metricool/TikTok brand label `ynb4b6r6` is accepted as its verified alias.
- `NY News` → Facebook Page + X account. The currently connected `New York News` label is accepted as its verified alias.

External owner steps are limited to creating or selecting those profiles in Metricool and granting Metricool the requested platform access. The server discovers the two brands by their verified exact-name aliases (or accepts explicit blog ID overrides), schedules each network separately through Metricool's official API, spaces same-lane/network posts by at least two minutes, and records successful Metricool post IDs in an idempotency ledger. Until a successful API response and later public evidence exist, an item is never counted as published.

The existing TikTok connection is independent and is not changed by this news workflow.

## Analytics and money

Metricool remains the source for social analytics after the Facebook Pages and X accounts are connected. The local metrics intake accepts observed impressions, engagements, clicks, and shares plus optional `revenueUsd` and `costUsd`; reports calculate `profitUsd` from recorded values only. Queue state, a scheduled post, and expected monetization never create synthetic analytics or revenue.

## Operations

The local API surface lives under `/api/clippers/local-news`:

- `GET /status`
- `POST /bootstrap`
- `POST /run-cycle`
- `POST /ingest-events`
- `POST /record-metrics`

The intake automation runs every five minutes by default. Delivery automatically remains blocked until the Metricool token, user, matching brand, and requested Facebook/X profile are available. Failures are isolated by source so one unavailable feed does not stop the other city. Source responses, normalized event state, delivery decisions, successful Metricool IDs, and metric imports are recorded as local artifacts without secrets.

## Rollback

Pause the local-news automation, disconnect the two news brands in Metricool, and remove the local-news routes/configuration. Existing sports, memes, streamer, and other Metricool brands remain independent.
