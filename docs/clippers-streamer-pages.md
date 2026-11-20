# Clippers streamer pages (cloud)

The NY News (6595747) and Miami News (6591612) Metricool brands are now streamer clip pages.
Default page names: Miami (6591612) is "Clipwave Miami" (suggested handle `@clipwave.mia`) and NYC (6595747) is
"Clipwave NYC" (suggested handle `@clipwave.nyc`). The repository variable `CLIPPERS_CITY_PAGE_NAMES` overrides them per brand, for example
`{"6591612":{"name":"Clipwave Miami","handle":"@clipwave.mia"}}`. Brands left out keep the default.
The local-news Metricool sender is retired (`CLIPPERS_LOCAL_NEWS_SENDER_ENABLED` must be `"true"` to resume it).
Its ledgers stay on disk and are read-only.

## Clip policy
- A creator is clipped unless they explicitly prohibit it: Twitch user description, YouTube channel description,
  `KNOWN_PROHIBITED_CREATORS`, or a takedown (`shared/clippers-streamer-policy.mjs`, Spanish and English patterns).
  Twitch panels are not exposed by the Helix API, so they are not checked automatically. Add them to the known list by hand.
- Every caption credits `@handle` and links the source. Clips are short (60 s or less) and edited. Full streams and VODs are never posted.
- `POST /api/clippers/streamers/takedown` (owner only) blocks a creator, group or clip forever and starts a 24 h removal clock.
  The office shows `takedown_overdue` once that clock runs out. Remove the live post in Metricool.

## Pipeline
| Stage | Where | Notes |
|---|---|---|
| Discovery | `.github/workflows/clippers-streamers.yml` → `script/clippers-streamer-discovery.mjs` | Twitch Helix (app token): top live, top categories, last-24 h clips. YouTube Data API: channel snippets, uploads, trending gaming. About 30–60 units per run, and `search.list` is never used. |
| State | PostgreSQL `agent_council_state`, namespace `clippers-streamers:<owner>` | Uses the existing council store. No new table. |
| Approval | `pending_actions` (`clippers.streamer_clip_publish`) | Shows in the existing pending-actions panel. `CLIPPERS_STREAMER_AUTO_PUBLISH=true` pre-approves rows. It is off by default. |
| Download | Cloud: `.github/workflows/clippers-streamers-publish.yml` → `script/clippers-streamer-cloud-worker.mjs` | Only approved rows (`approved`/`executed`). `yt-dlp` (`bin/yt-dlp`, or pip with `CLIPPERS_YTDLP_FROM_PIP=true`) downloads only the needed section. YouTube tries `--impersonate chrome` first (curl-cffi). Twitch clips are picked from the official Helix clip metadata. |
| Render | Cloud: `script/clippers-streamer-cloud-render.mjs` | ffmpeg only, with no shell, ImageMagick, zsh or BSD `stat`. The output is 1080×1920 with a blurred fill, the hook text and the `Créditos: @handle` credit burned in using the bundled `assets/fonts/DejaVuSans-Bold.ttf`, plus loudness normalization. It is at most 60 s (`CLIPPERS_STREAMER_CLIP_SECONDS`, default 45). Long YouTube videos are cut at the "most replayed" heatmap peak. ffprobe checks size, audio and duration. |
| Publish | Existing Metricool adapter `script/clippers-portfolio-metricool.mjs` | The policy is checked again at publish time: the stored policy, a live re-read of the creator's description, takedowns, the known list, the credit and the 60 s limit. It is checked once more inside the owner lock right before each write. The media is staged as a temporary asset on the `clippers-media-staging` prerelease of this repository and deleted only once Metricool holds its own SHA-verified copy or the slot is 2 h past. It is never deleted while a write is uncertain, and leftovers are swept after 48 h. The adapter verifies the destination identity and publish permission, enforces the daily cap of 5 and checks for slot, caption and media duplicates before each write. A write with an uncertain outcome is never sent again: it is reconciled read-only. |
| Learning | Same job, `script/clippers-streamer-cloud-learning.mjs` | Reads Metricool post analytics 24–48 h after the slot. It runs an A/B test on the burned hook (`title` vs `teaser`) per destination with the existing `evaluateExperiments`, and orders creators by relative median views. |
| Office | Orchestra role `clippers-streamers` + `GET /api/clippers/streamers/status` | Shows held reasons such as `missing_secret:TWITCH_CLIENT_ID`. `cloudPublish` lists the recent posts (use it to remove posts after a takedown) and the learning summary. |

### Platforms
YouTube answers GitHub-hosted runner IPs with "Sign in to confirm you're not a bot", even with `--impersonate chrome` and a working curl-cffi. That was verified on 2026-11-19. The cloud lane therefore takes **Twitch clips only** (`CLIPPERS_STREAMER_CLOUD_PLATFORMS`, default `twitch`).
While the cloud publisher is on, discovery creates approval rows only for those platforms, so unpublishable YouTube approvals don't fill the open-approval budget. This also means **no new YouTube approvals are created for the Mac lane** while the cloud publisher is on. Add `youtube` to `CLIPPERS_STREAMER_CLOUD_PLATFORMS`, or turn the publisher off, to get them back.
A YouTube bot check is reported as `SOURCE_BOT_CHECK`, and the run stops trying other YouTube clips. Every failed clip prints a log-safe line: `clip diagnostics: {platform, step, impersonate, exitCode, detail}`. The detail is the last stderr line, with URLs, paths, e-mails and long tokens removed.

### Testing a branch
A `workflow_dispatch` of the publish workflow on a branch other than `main` runs the `branch-dry-run` job. That job:
- fails unless `dry_run=true`
- gets no Metricool token and only a read-only `GITHUB_TOKEN`
- renders only, keeping the renders as a 1-day artifact, and writes no state

Dispatches on `main`, and all scheduled runs, use the reviewed `OFFICE_SOURCE_REF` (or `main`). Discovery always runs `OFFICE_SOURCE_REF`/`main`.

### Destinations and schedule
The adapter allowlist (`script/clippers-portfolio-metricool.mjs`) matches the live Metricool identities (getBrandSettings, 2026-11-19): `6431685/tiktok/streamersus` (memes), `6431687/tiktok/streamersclipusa` (SPORT), `6591612/tiktok/news305miami` and `6591612/facebook/1193011863901514`.
Ledger rows written under the old account names `streamersclips` and `ynb4b6r6` still resolve to the same destination through `LEGACY_ACCOUNT_ALIASES`, so they keep counting toward the caps and duplicate checks.
By default this lane posts only to the **three TikTok accounts**. Add Facebook by listing it in `CLIPPERS_STREAMER_CLOUD_DESTINATIONS`, for example `6431685:tiktok:streamersus,6431687:tiktok:streamersclipusa,6591612:tiktok:news305miami,6591612:facebook:1193011863901514`.
`6595747` (NY, Facebook only) stays held until it is added to that allowlist.
The default slots are 11:00, 13:30, 16:00, 18:30 and 21:00 America/New_York (`CLIPPERS_STREAMER_CLOUD_SLOTS`). Destinations are staggered by 7 minutes. There are at most 5 posts per destination per day (all lanes, enforced by Metricool preflight) and 2 clips per run (`CLIPPERS_STREAMER_CLOUD_CLIPS_PER_RUN`, max 5). The job runs after the office worker, between 09:00 and 19:59 New York time, at most once every 3 h (`CLIPPERS_STREAMER_CLOUD_MIN_INTERVAL_MINUTES`). The repository is public, so standard runners cost $0. A run takes a few minutes and has a 30-minute timeout.

### Enable / pause
1. Add the repository Actions secrets `METRICOOL_USER_TOKEN` and `METRICOOL_USER_ID`. These are the same names the Metricool adapter already uses. The Twitch/YouTube secrets are listed below.
2. Set `CLIPPERS_CITY_PAGE_NAMES`. Test with `CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED=true` plus a manual dispatch with `dry_run` checked: the renders are kept as a 1-day artifact, nothing is uploaded or posted, and no clip state is written (approvals stay queued).
3. Go live by leaving `CLIPPERS_STREAMER_CLOUD_DRY_RUN` unset. Approvals still come from the pending-actions panel unless `CLIPPERS_STREAMER_AUTO_PUBLISH=true`.
4. Kill switch: `CLIPPERS_STREAMER_CLOUD_KILL_SWITCH=true` stops every later run (the job `if` and the script start both check it). A run that is already in progress cannot see variable changes, so cancel it in Actions. Each run takes no new clip after 20 min (`CLIPPERS_STREAMER_CLOUD_RUN_DEADLINE_MINUTES`). `CLIPPERS_STREAMERS_CLOUD_ENABLED=false` pauses discovery and publishing together.

`node --import tsx script/clippers-streamer-discovery.mjs --export-local-queue` still prints the approved queue for a manual Mac run.

Secrets (repository Actions): `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `YOUTUBE_API_KEY`, plus `METRICOOL_USER_TOKEN` and `METRICOOL_USER_ID` for publishing. The workflows also use
`OFFICE_DATABASE_URL` and `OFFICE_OWNER_ID`, which already exist. Set the `CLIPPERS_STREAMERS_CLOUD_ENABLED=false` variable to pause.

## Account lanes and growth loop (2-week test from 2026-11-20)

Code: `shared/clippers-account-lanes.mjs`, `script/clippers-streamer-cloud-worker.mjs` (`laneTarget`, `refreshGrowth`),
`script/clippers-streamer-cloud-learning.mjs` (`computeGrowth`). On by default; `CLIPPERS_STREAMER_LANES_ENABLED=false`
restores the legacy fan-out.

| Lane | Account | Language | Creators / content |
|---|---|---|---|
| memes | 6431685 TikTok @streamersus | EN | Kai Cenat, IShowSpeed, Adin Ross, Jynxzi, Duke Dennis, xQc, Agent00; English default |
| sports | 6431687 TikTok @streamersclipusa | EN | sports content (NBA/NFL/FIFA/2K/football keywords, Sports category), PlaqueBoyMax, Castro |
| miami | 6591612 Clipwave Miami (TikTok; Facebook when listed in `CLIPPERS_STREAMER_CLOUD_DESTINATIONS`) | ES only | Latin/Spanish streamers (Westcol, ElMariana, JuanSGuarnizo, Rivers, Spreen, Ibai, ...), any Spanish clip |
| nyc | 6595747 Clipwave NYC (Facebook Reels) | EN | Fanum, NYC IRL content. Held until a Facebook Page is connected in the adapter allowlist |

- **One video file -> one account.** The worker checks and claims a media ledger entry (same rendered SHA-256, same
  source clip, or same Twitch VOD within 60 s) inside the owner lock before each write, and Metricool's brand-wide
  calendars (drafts included, day +-1) are read before each write (`crossAccountPreflight`). Follow-up clips of a stream
  stay on the account that used it first. Other languages are not routed.
- **Edit:** peak-first cut (loudest ebur128 moment at ~1 s), 15-35 s (default 28), 3-6 word upper-case hook in the top
  third, burned word-by-word captions when `CLIPPERS_WHISPER_BIN` + `CLIPPERS_WHISPER_MODEL` are set (otherwise none).
- **Caption:** curiosity line + question + creator name and credit/source + 3-5 hashtags; duet, stitch and comments on.
- **Slots:** 10/12/16/18/20 ET, weekends -30 %; 8 a day (6 on weekends) once the weekly median passes 1k. Metricool
  best-time (read-only, refreshed weekly) reorders hours 09-22 when it has data.
- **Owner override (on now):** `CLIPPERS_LANES_AUTOPUBLISH_OVERRIDE` defaults to `memes:tiktok,sport:tiktok,miami:tiktok`
  (@streamersus 6431685, @streamersclipusa 6431687, @news305miami 6591612). Those TikTok accounts auto-publish
  without the 1k median gate (stale/missing analytics no longer force drafts there) and their clips skip the BlackOps
  owner approval (`CLIPPERS_STREAMER_AUTO_PUBLISH` unset = `lanes`). One account per clip, language, prohibition/takedown,
  daily caps (5/day until the real median passes 1k) and slots stay enforced. Facebook and NYC can never be overridden.
  Office/Panel growth view shows `auto (owner override)`. **Kill switch:** set repo variable
  `CLIPPERS_LANES_AUTOPUBLISH_OVERRIDE` to `""` (env) or `off` (GitHub variables cannot be empty) -> drafts + owner approval.
- **Auto-publish gate:** per account, weekly median >= 1k views over >= 5 posts. Below that, posts go to Metricool as
  drafts (`draft:true, autoPublish:false`) for owner approval. `CLIPPERS_STREAMER_LANE_AUTOPUBLISH=false` keeps all drafts.
- **Growth loop (cloud):** job `growth` in `clippers-streamers-publish.yml` daily at 08:00 NY (and every 6 h inside the
  publish job): kill a creator / hook / hour with median < 300 after 6 posts; > 10k views in 24 h -> 3 more clips from
  that stream/creator on that account within 24 h and promote the hour; > 100k -> double that creator's share.

### Review follow-ups (2026-11-20)

- Language is normalised (`es-419` -> `es`). Only `en` and `es` are routed, and only to a lane with that language;
  unknown or other languages are never posted (an English Ibai clip goes to an English lane, a Spanish Kai Cenat clip to Miami).
- Auto-publish requires a growth pass < 36 h old computed from Metricool account analytics; otherwise drafts.
- `CLIPPERS_STREAMER_LANES_ENABLED=false` never restores the fan-out: one account (first planned) and drafts only.
- Pauses (kills) expire 14 days after the arm's newest post. Pre-write defers drop their media-ledger claim.
  `crossAccountPreflight` is required on the lane path. Without a Twitch VOD, broadcaster + clip time +-60 s is the segment.
- Metricool drafts read back as `draft:true, autoPublish:false`, provider `PENDING`, `publicationDate` in America/New_York;
  `confirmSchedule` matches exactly that for draft writes.

### Note for the Facebook owner-action hold lane (`claude/clippers-facebook-identity-hold`)

`laneTarget` already skips any destination whose `cloudPublish.holds[key].status === 'held_owner_action'` (it picks the
lane's other destination, e.g. Miami Facebook vs TikTok, or holds the clip with `lane_destination_held:<lane>`). When the
hold lane merges on top of lanes:
1. In lane mode, compute `heldTargets` only from the picked destination (`lanePick.destination`), never from
   `config.destinations`, so a held copy is queued for at most one account.
2. Queue it with the lane fields (`lane`, `streamKey`, `segment`, `dailyLimit`, `countDrafts`, `allowDuetStitch`) and
   `draft` from `lanePick` (pass `lane: lanePick` to `postItem` on release).
3. In the release transaction, run the same `mediaConflict(mediaEntriesOf(c), ...)` check and `mediaEntry` claim as the
   main write path, and `dropClaim` when the release is deferred before any Metricool write; call `crossAccountPreflight`
   after `preflight`.

## Word-by-word captions (cloud) and the Mac lanes on the shared ledger

- **Cloud captions.** `clippers-streamers-publish.yml` builds whisper.cpp `v1.8.7` (commit `48f628a8`, cmake, static) and
  downloads the multilingual `ggml-base.bin` (SHA-1 from the upstream models README; optional extra SHA-256 pin in the
  repository variable `CLIPPERS_WHISPER_MODEL_SHA256` — the run logs the observed SHA-256). Both are cached with
  `actions/cache`. Only the rendered 15-35 s cut is transcribed, with `-l es` for Clipwave Miami and `-l en` for the
  other lanes. Best effort: on any failure the clip still renders and the clip ledger records
  `captions: transcription_failed | whisper_not_configured | no_speech | word_by_word` (+ `captionsError`).
  Turn off with `CLIPPERS_WHISPER_ENABLED=false`.
- **Mac lanes.** `clippers-metricool-autopilot.mjs`, `clippers-daily-learning.mjs` and `clippers-weekly-scheduler.mjs`
  call `script/clippers-mac-ledger-guard.mjs` right before every Metricool write. It refuses (fail closed) a clip whose
  source/segment/file hash is already on another account, a stream owned by another account, a creator routed to
  another lane, or a caption/language that does not match the account (es only on Clipwave Miami). The Metricool
  cross-brand calendar check always runs. With `OFFICE_DATABASE_URL` + `OFFICE_OWNER_ID` in the Mac config root's
  env file the claim is written to the same Postgres ledger the cloud worker reads; without them a local ledger
  (`clippers_workspace/reports/clippers-media-ledger.json`) is used and mirrored on the next run that has the database.
  `CLIPPERS_LEDGER_REQUIRE_DATABASE=true` makes the database mandatory.
