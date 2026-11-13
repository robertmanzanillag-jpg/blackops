# Clippers CEO runtime

Four independent local LaunchAgents keep content production, sequential YouTube delivery, TikTok operations, and health checks from blocking each other:

- `com.blackops.clippers-content-worker` prepares the ES/EN motivation lanes and the weekly sleep artifact at 4:00 AM local time.
- `com.blackops.clippers-youtube-delivery-worker` packages reviewed artifacts and then delivers only the produced reviewed queue at 6:30 AM.
- `com.blackops.clippers-free-worker` runs the guarded Marketplace/Metricool/TikTok cycle at 7:00 AM.
- `com.blackops.clippers-daily-watchdog` checks content, YouTube delivery, and TikTok evidence at 10:00 AM.

No job claims active work unless it writes a fresh observable report. The content worker has no network, credentials, upload, publish, paid-service, Marketplace, Metricool, or TikTok access.

## Cycle

1. Normalize fresh local marketplace snapshots and verify rights evidence.
2. Reuse or upload approved MP4 media to the configured public media provider.
3. Build the daily CEO decision and Metricool queue, capped at five posts and USD 0.
4. Deduplicate and schedule only proof-backed items on the authorized Metricool blog/account.
5. Reconcile scheduled rows with an exact public TikTok URL and explicit metrics.
6. Keep cleanup non-destructive unless its separate execute flag is explicitly enabled.

The worker stops at the first failed gate. Inspect `GET /api/clippers/runtime-status` for a safe status and next action, and the local report under `clippers_workspace/reports/free-local-worker/latest.json` for operator detail.

## Activation after merge and QA

Preview the LaunchAgent without installing it:

```sh
npm run clippers:install-free-local-worker
```

Before installation, create these explicit owner-only configuration files:

`~/.local/share/blackops/clippers-workspace/config/clippers-content-worker.json`

`~/.local/share/blackops/clippers-workspace/config/clippers-youtube-upload-packager.json`

`~/.local/share/blackops/clippers-workspace/config/clippers-youtube-delivery.env`

The content schema is documented in `docs/clippers-content-local-worker.md`; YouTube owner authorization is documented in `docs/clippers-youtube-upload-packager.md`; and the selected environment allowlist is documented in `docs/clippers-youtube-delivery-worker.md`. Keep every file at mode `600`. The installer rejects missing, symlinked, group-readable, or world-readable files and never puts OAuth values in a plist.

Install the daily workers only from a clean runtime exactly at `origin/main`:

```sh
CLIPPERS_LAUNCH_AGENT_DRY_RUN=false npm run clippers:install-free-local-worker
```

YouTube OAuth values and the global public-publish gate remain in the dedicated selected environment file. The wrapper exports only the exact per-lane YouTube channel/OAuth allowlist and never logs values. The installer intentionally does not copy secrets into the plist. Do not enable paid spend, paid AI, cleanup execution, or accounts outside the Clippers inventory.

Installation bootstraps and verifies all four services but deliberately does not kickstart any of them. They begin on their next calendar schedule unless Robert separately authorizes a manual run.

The content worker writes `reports/content-worker/clippers-content-local-worker-latest.json`; delivery writes `reports/youtube-delivery-worker-latest.json`. The watchdog reports freshness plus planned/rendered/shortfall counts independently for Spanish motivation, English motivation, and sleep. It counts only exact confirmed YouTube watch URLs from a valid delivery report as upload proof; planned, rendered, packaged, blocked, or uncertain work is never called published.

## Current supply contract

Marketplace discovery consumes local snapshots documented in `docs/clippers-marketplace-intake.md`. A missing, stale, unjoined, expired, incompatible, or rights-unverified campaign blocks the cycle. The worker never fills the daily target with duplicates or unverified content.

## Rollback

Unload `com.blackops.clippers-content-worker`, `com.blackops.clippers-youtube-delivery-worker`, `com.blackops.clippers-free-worker`, and `com.blackops.clippers-daily-watchdog`; restore prior plists if operations backed them up; then revert this PR. Do not delete local MP4s or publication evidence as part of rollback.
