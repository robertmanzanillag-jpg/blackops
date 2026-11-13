# Clippers YouTube upload packager

`clippers-youtube-upload-packager.mjs` is the offline, deterministic bridge from a completed `clippers-content-local-worker` report to the reviewed queue consumed by `clippers-youtube-publish-worker.mjs`. It never uploads, accesses credentials, uses the network, or incurs API cost.

## Owner authorization config

The config is an owner-controlled `0600` JSON file. Paths must resolve inside `workspaceRoot`. All three channel, privacy, and audience choices are mandatory even when a run has no candidate in a lane. `madeForKids` must be an explicit JSON boolean selected by the owner; strings such as `"false"` are rejected.

```json
{
  "schemaVersion": 1,
  "workspaceRoot": "~/.local/share/blackops/clippers-workspace",
  "sourceReport": "reports/content-worker/clippers-content-local-worker-latest.json",
  "authorization": {
    "blanketAuthorized": true,
    "authorizedBy": "Robert",
    "authorizedAt": "2026-08-24T15:00:00.000Z",
    "privacyPolicyAccepted": true,
    "privacyPolicyVersion": "2026-08-26",
    "privacyPolicyAcceptedBy": "Robert",
    "privacyPolicyAcceptedAt": "2026-08-26T05:00:00.000Z",
    "motivationShortsPerDayPerChannel": 5,
    "sleepVideosPerRollingSevenDays": 1,
    "youtubeApiProjectAuditVerified": true
  },
  "scheduling": { "timeZone": "America/New_York" },
  "channels": {
    "motivation_es": {
      "channelId": "UC_REPLACE_WITH_EXACT_ES_CHANNEL_ID",
      "privacyStatus": "private",
      "madeForKids": false,
      "schedule": { "enabled": true, "localTimes": ["08:00", "11:00", "14:00", "17:00", "20:00"] }
    },
    "motivation_en": {
      "channelId": "UC_REPLACE_WITH_EXACT_EN_CHANNEL_ID",
      "privacyStatus": "private",
      "madeForKids": false
    },
    "sleep": {
      "channelId": "UC_REPLACE_WITH_EXACT_SLEEP_CHANNEL_ID",
      "privacyStatus": "private",
      "madeForKids": false
    }
  }
}
```

Valid privacy choices are `private`, `unlisted`, and `public`. A public lane additionally requires a distinct explicit choice:

```json
"publicAuthorization": {
  "public": true,
  "authorizedBy": "Robert",
  "authorizedAt": "2026-08-24T15:30:00.000Z"
}
```

The packager copies this second authorization to both the uploader item and reviewed queue entry. Future scheduling is public intent even though the YouTube upload request uses `privacyStatus: private`; every scheduled item therefore requires the same authorization. The publish worker still requires both `CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED=true` and `CLIPPERS_YOUTUBE_API_PROJECT_AUDIT_VERIFIED=true`, so a config file alone cannot publish anything. The audit gate is required because unverified API projects can have uploaded videos forced private by YouTube.

The packager also copies the exact per-channel `madeForKids` boolean into both the uploader item and reviewed queue entry. Packaging fails closed before producing any item if any configured channel omits this owner audience designation or uses a non-boolean value. The uploader maps the item value to YouTube's `status.selfDeclaredMadeForKids` field. Exact reruns also reject a legacy or tampered pending queue when the item and queue audience values are missing, non-boolean, or disagree.

Before packaging any upload, the owner authorization must also record Robert's explicit acceptance of the pinned Clippers YouTube privacy-policy version `2026-08-26`. The boolean, exact version, owner name, and valid acceptance timestamp are all required. The normalized acceptance evidence is copied into every uploader item, every reviewed queue entry, and the queue authorization summary. A missing, stale, malformed, or non-Robert acceptance fails closed without packaging or uploading. Exact reruns validate the acceptance evidence in all three locations before preserving an existing reviewed queue. The uploader independently rejects items without an explicit boolean audience or valid pinned acceptance, and the publish worker requires exact item/entry/queue agreement so direct invocation cannot bypass either gate.

The normal target is five Shorts per lane/day. A target from 6 through the safe ceiling of 10 is accepted only when `scheduling.learningRecommendation` pins a workspace-contained SHA-256 evidence JSON with `basedOnRealMetrics: true`, a matching `recommendedTargetPerDay`, and at least one numeric metric. There must also be that many distinct quality-passed candidates and that many local times separated by at least two hours. Missing candidates produce no quota filler. Sleep remains one per rolling seven days.

## Gates

- Pins the exact completed content-worker report by SHA-256.
- Requires an explicit boolean `madeForKids` choice for every configured channel and propagates it unchanged to the item and reviewed queue.
- Requires Robert's explicit acceptance of privacy-policy version `2026-08-26` and propagates normalized evidence to every item and queue record.
- Re-hashes every MP4 and its source manifest/provenance.
- Accepts motivation only when the source script and procedural audio are explicitly owned-original with no third-party source or asset.
- Accepts sleep only when the generator's rights manifest pins the output and owned generated visual, reports no external audio or paid service, and passed its production QA.
- Uses `ffprobe` to require an MP4 with valid video and audio streams, correct orientation, and lane duration.
- Fully decodes every video and audio stream with FFmpeg before setting `playbackComplete: true`; a sampling-only check is not sufficient.
- Defaults to five Shorts per New York day in each language lane, permits an evidence-backed target up to 10, and enforces one sleep upload per rolling seven days, including active ledger outcomes.
- Converts configured New York wall-clock times to future RFC3339 timestamps with DST-aware round-trip validation; Shorts in one lane must be spaced by at least two hours.
- Deduplicates item IDs, paths, and media hashes. An exact rerun preserves the already reviewed queue. A different report cannot replace a non-empty pending reviewed queue.

Only successfully gated candidates get a schema-valid item, `youtube_video` rights evidence, and `youtube_video_qa` evidence. Files are written atomically with owner-only mode. Native-language titles and descriptions come only from the approved source script or sleep manifest; the packager does not translate or invent source rights.

## Run

```sh
node script/clippers-youtube-upload-packager.mjs \
  --config /absolute/path/clippers-youtube-upload-packager.json
```

Outputs inside the workspace:

- `youtube/items/*.json`
- `youtube/rights/*.json`
- `youtube/qa/*.json`
- `youtube/reviewed-upload-queue.json`
- `reports/youtube-upload-packager-latest.json`

The reviewed queue is an input to the separate publish worker. Creating it performs no upload and no network request. Packager reports label future items `scheduled: true`, but always set `publicConfirmed: false` and `publicUrl: null` because packaging is not evidence of publication.
