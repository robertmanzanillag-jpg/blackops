# Clippers cloud lanes (Mac OFF)

Goal: the whole Clippers factory runs in GitHub Actions as part of the office, with the owner's Mac turned off.
The office projection, the streamer lanes (#463/#467/#479/#481/#482) and these lanes all keep their state in
PostgreSQL (`agent_council_state`). Media lives in Google Drive. Nothing is stored on a Replit disk or runner disk.

## 1. Inventory: what only ran on the Mac

| Mac LaunchAgent (NY time) | Scripts | What it does | Cloud path |
|---|---|---|---|
| `com.blackops.clippers-content-worker` 04:00 | `clippers-content-local-worker` → `content-learning-ceo`, `motivation-shorts`, `sleep-video-generator` | Motivation ES/EN Shorts (≤5/day/channel) and a weekly 8 h sleep video from owned manifests and visuals. No network. | **`clippers-cloud-lanes.yml` job `owned_content`** (motivation only): Drive workspace hydrate → same worker → media to Drive, ledgers to Postgres. The sleep video is its **own job `sleep`** (Sunday 00:00 NY) behind `CLIPPERS_CLOUD_SLEEP_ENABLED` (default off) until its runtime is measured. It has its own lane ids (`sleep_content`, `sleep_delivery`) with their own records and interval. It is handed over by retiring `content`/`youtube_delivery` and shares one concurrency group with `owned_content` (they queue, never overlap). Needs the portable renderer (#483). |
| `com.blackops.clippers-youtube-delivery-worker` 06:30 | `run-clippers-youtube-delivery-worker.sh` (zsh) → `youtube-delivery-worker` → `youtube-upload-packager`, `youtube-publish-worker` | Packages today's renders and uploads them with the YouTube Data API (per-lane OAuth refresh tokens). | **Same job, after content** (and in `sleep`, after the sleep render), only with `CLIPPERS_YOUTUBE_CLOUD_UPLOAD_ENABLED=true` (default false). The Node runner passes the same exact env allowlist as the zsh wrapper (`youtubeEnv`). Secrets come from Actions secrets, never from a file. |
| `com.blackops.clippers-free-worker` 07:00 | `clippers-free-local-worker` → `marketplace-refresh`, `marketplace-intake`, `render-campaign-drafts`, `upload-metricool-media`, `streamer-growth-ceo`, `metricool-autopilot`, `reconcile-publications`, `cleanup-published-vyro-media` | Marketplace (Vyro/Whop/Content Rewards/Clipping) campaigns → drafts → Drive → Metricool (≤5/day) → reconcile. | **Job `marketplace`**: everything except `marketplace-refresh` (it needs logged-in browser sessions). Intake reads owner snapshots from Drive `research/marketplace-snapshots/`. Metricool writes stay off until `CLIPPERS_MARKETPLACE_CLOUD_PUBLISH_ENABLED=true`. |
| `com.blackops.clippers-daily-watchdog` 10:00 | `clippers-daily-watchdog` → `portfolio-discovery`, `portfolio-prepare`, `daily-learning`, `orchestra-analytics` | Freshness checks, YouTube RSS discovery, prepare, the A/B daily learning (it schedules to Metricool). | **Covered, not re-implemented**: discovery = `clippers-streamers.yml`, publish + learning loop = `clippers-streamers-publish.yml` (#479). Freshness = the office lane overlay + self-heal. You only retire it. |
| BlackRoom local editor (separate installer) | yt-dlp with browser cookies | DJ sets for BlackRoom. | Out of scope for Clippers. It stays on the Mac or moves to owner-uploaded sets. |

## 2. Lane lock and Mac retirement (no double posting)

`shared/clippers-cloud-lanes.mjs` keeps one lease per lane in `clippers-cloud-lanes:<owner>`:

- **Retirement is the only handover.** A real (non-dry) cloud run of a lane is refused (`mac_lane_not_retired`, shown as *idle*) until that lane was retired on the Mac. A stale Mac heartbeat (Mac off) is not a handover.
- Every Mac entry point (content, YouTube delivery, free worker, watchdog) calls `macLaneGate(lane)` before running.
  It writes a Mac heartbeat. It refuses (exits 0 without work) when the lane is **retired** or the cloud holds a fresh lease.
  Without `OFFICE_DATABASE_URL`/`OFFICE_OWNER_ID` in the Mac selected env, or on a database error, it fails open and logs it.
  That is the pre-cloud behavior. This is why the retirement step also unloads the agents.
- After each lane, that lane's text ledgers go to Postgres and its media to Drive, and its run is recorded, **before** the next lane starts (in particular right after the YouTube delivery). Each lane has its own time limit below the 340 min job limit (content 60, delivery 45, marketplace 60, sleep render 240 min; `CLIPPERS_CLOUD_LANE_TIMEOUT_MINUTES` overrides), so a hang is recorded as `lane_timeout` and counted by self-heal. A failed persist stops the job.
- Text state is capped at 6 MB. Ledger files are never evicted. If they alone exceed the cap, the run fails with `workspace_text_over_cap` instead of dropping anything.
- Dry runs take no lease, upload nothing and persist nothing. That is how you QA the cloud while the Mac still runs.

Steps (on the Mac, from the runtime checkout):

1. `zsh script/clippers-mac-retire.sh seed` copies the Mac workspace into the cloud. It is an **allowlist**: only `config/ content/ manifests/ visuals/ rights/ research/ renders/ reports/`, and only text or media extensions. Text files of 1 MB or less go to Postgres with the Mac path replaced by `{{CLIPPERS_WORKSPACE}}`. Media up to 300 MB go to the Drive folder. Dot-files and dot-dirs, and anything named like a credential, secret, token, cookie, keychain, session, storage-state, auth/login JSON, `.metricool`, `.netrc`, `.npmrc`, SSH key, pem/p12/pfx/jks/keystore or a browser profile, are never copied. The script refuses `/`, `$HOME` and `~/Library`, and requires `config/clippers-content-worker.json` in the workspace. It uses the Mac's own Drive OAuth client, so the default `drive.file` scope can read the files back in the cloud.
2. In Actions, dispatch **Clippers cloud lanes** with `dry_run=true` for `owned_content` and `marketplace`. Check the office roles (or `node script/clippers-cloud-lanes.mjs --status`).
3. `zsh script/clippers-mac-retire.sh retire` (default: all four lanes). It requires a completed cloud run or dry run in the last 7 days per lane, and a streamer cloud run for `watchdog`. A delivery dry run uploads nothing, so it never counts: retire `youtube_delivery` with `FORCE=1` after the content QA (or later, once uploads are enabled). `FORCE=1` skips that check. It marks the lanes retired in Postgres **first**, then runs `launchctl bootout` on each agent and moves its plist to `~/Library/LaunchAgents/retired-clippers/`.
4. Rollback: first set `CLIPPERS_CLOUD_LANES_ENABLED=false`, then run `zsh script/clippers-mac-retire.sh restore [lanes] --cloud-paused`. It refuses without the flag. The Mac takes the leases at once and the agents are loaded again.

## 3. Owner setup (exact secrets and variables)

Repository **secrets**:

| Secret | For | Notes |
|---|---|---|
| `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN` | all lanes | Same OAuth client as the Mac (`drive.file` scope is enough after `seed`). If you want to drop files from the Drive web UI, mint the token with `drive` scope (`GOOGLE_DRIVE_SCOPES`). |
| `CLIPPERS_DRIVE_WORKSPACE_FOLDER_ID` | all lanes | An empty Drive folder for the cloud workspace. Add it to the Mac selected env too, for `seed`. |
| `CLIPPERS_YOUTUBE_{ES,EN,SLEEP}_{CHANNEL_ID,CLIENT_ID,CLIENT_SECRET,REFRESH_TOKEN}` | YouTube delivery | The same values as the Mac YouTube selected env. At least one complete channel is needed. |
| `METRICOOL_USER_TOKEN`, `METRICOOL_USER_ID` | marketplace publish | These already exist for the streamer publisher. |
| `OFFICE_DATABASE_URL`, `OFFICE_OWNER_ID` | state | These already exist. |
| `YT_DLP_PROXY` (optional) | YouTube *sources* for streamer clips | See section 5. |

Repository **variables**: `CLIPPERS_CLOUD_LANES_ENABLED=true` (off by default), `CLIPPERS_YOUTUBE_CLOUD_UPLOAD_ENABLED` (default false), `CLIPPERS_CLOUD_SLEEP_ENABLED` (default false), `CLIPPERS_CLOUD_LANES_KILL_SWITCH`,
`CLIPPERS_MARKETPLACE_CLOUD_PUBLISH_ENABLED` (Metricool + public media for the marketplace lane, default false),
`CLIPPERS_METRICOOL_BLOG_ID`, `CLIPPERS_TIKTOK_ACCOUNT`, `CLIPPERS_MARKETPLACE_SNAPSHOT_MAX_AGE_HOURS`
(default 48; set 192 for weekly snapshots), `CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED` / `CLIPPERS_YOUTUBE_API_PROJECT_AUDIT_VERIFIED`
(default false: an unaudited API project uploads private only), `CLIPPERS_CLOUD_LANES_MIN_INTERVAL_HOURS` (20),
`CLIPPERS_CLOUD_MEDIA_HYDRATE_DAYS` (3).

A missing secret is never a failure. The lane records `missing_secret:<NAME>`, the office shows it as an owner note, and the job exits successfully with a notice.

## 4. YouTube quota

The default quota is 10,000 units/day per Google Cloud project. An upload costs about 1,600 units, so about 6 uploads/day per project.
Motivation ES + EN at 5/day each plus the weekly sleep video is about 10 to 11 uploads on the busiest day. Use **separate OAuth clients/projects per lane** (the `ES`/`EN`/`SLEEP` secret sets already allow that), or file the quota increase via the API audit (`docs/clippers-youtube-api-audit-runbook.md`). Quota is free.

## 5. YouTube *source* downloads (streamer clips)

YouTube blocks yt-dlp on datacenter IPs ("confirm you're not a bot").

- **(a) Default**: no YouTube sources in the cloud. `CLIPPERS_STREAMER_CLOUD_PLATFORMS` defaults to `twitch`. The cloud clips Twitch (and Kick once listed). Discovery still ranks YouTube creators via the official API.
- **(b) Optional**: set the secret `YT_DLP_PROXY` (a residential proxy URL) and add `youtube` to `CLIPPERS_STREAMER_CLOUD_PLATFORMS`. Only YouTube downloads go through the proxy, and only the selected section is downloaded (≤ 60 s clip cut). Cost: about 8–15 MB per clip at ≤ 1080p. At 4 clips/run × 4 runs/day that is about 5–7 GB/month, or about **$20–$60/month** at typical residential rates ($3–$8/GB). Pay-as-you-go plans start at about $15–$30/month.
- **(c)** Owner-licensed sources: drop files into Drive, then use the marketplace/owned lanes.

## 6. Cost (private repo)

- Actions minutes (Linux, 1×): `owned_content` takes about 15–25 min/day (ffmpeg renders + uploads). The weekly 8 h sleep render at 1 fps takes about 60–120 min/week. `marketplace` takes about 10 min/day. That is about **1,300–1,700 min/month** for these lanes. It adds to the streamer jobs (about 1,500–2,500 min/month) and the office worker. Private repos get 2,000 included minutes on Free/Pro (3,000 on Team). Overage is $0.008/min, so 1,500 extra minutes is about **$12/month**.
- Drive storage: $0 within the existing plan (motivation ~20 MB × 10/day ≈ 6 GB/month, sleep 1–2 GB/week). Prune `renders/` older than 30 days, or upgrade Google One storage (100 GB is $1.99/month).
- Postgres: a few MB in the existing database. YouTube API: $0. Metricool: existing plan. AI: $0 (deterministic renders).
