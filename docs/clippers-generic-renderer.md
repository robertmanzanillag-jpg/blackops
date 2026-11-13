# Clippers generic deterministic renderer

`script/clippers-render-campaign-drafts.mjs` turns explicitly approved local source ranges into verified vertical MP4 drafts. It is deliberately offline and fail-closed: it never downloads media, opens a browser, calls an AI service, spends money, publishes, or infers cuts from a source video.

## Required inputs

The renderer reads the fresh, rights-verified campaign catalog at `clippers_workspace/research/paid-streamer-campaigns.json`. A campaign must still be active, joined, observed within 48 hours, unexpired, compatible with the configured TikTok account, and backed by a matching local rights-evidence file.

Every cut must be declared in a regular JSON file under `clippers_workspace/research/campaign-cut-manifests/`:

```json
{
  "schemaVersion": 1,
  "campaignId": "authorized-campaign-id",
  "accountHandle": "streamersclipusa",
  "cuts": [
    {
      "id": "specific-scene-01",
      "sourceFile": "source-drop/approved/campaign/source.mp4",
      "sourceSha256": "optional-but-recommended-64-character-sha256",
      "startSeconds": 12.5,
      "durationSeconds": 24,
      "subtitleFile": "source-drop/approved/campaign/specific-scene-01.srt"
    }
  ]
}
```

`endSeconds` may replace `durationSeconds`. Source and subtitle paths must resolve to non-symlinked regular files inside `CLIPPERS_WORKSPACE_ROOT`. Subtitles use SRT cues relative to the declared cut; supplied captions are rendered locally into the video with ImageMagick and FFmpeg. A supplied `sourceSha256` is enforced. Cuts shorter than 5 seconds, longer than 180 seconds, outside the source duration, or sourced from video without audio are rejected.

## Execution and outputs

```sh
CLIPPERS_WORKSPACE_ROOT=/absolute/path/to/clippers_workspace \
CLIPPERS_TIKTOK_ACCOUNT=streamersclipusa \
CLIPPERS_TARGET_DAILY_CLIPS=5 \
node script/clippers-render-campaign-drafts.mjs
```

The renderer invokes `ffmpeg` and `ffprobe` directly without a shell. It scales/crops to 1080×1920, preserves required audio, burns supplied subtitles, removes inherited metadata, and emits H.264/AAC MP4s under `drafts/campaigns/<campaign-id>/`. Each output is probed for 9:16 dimensions, audio, and duration before an atomic rename.

It writes `reports/campaign-draft-renderer.json` atomically and retains every successful source range in `reports/campaign-draft-renderer-ledger.json`. Every successful row records source, output, and source-range hashes; the exact media probe; and SHA-256 evidence frames from the beginning, middle, and end. The accepted draft paths are also added atomically to the matching campaign's `draftFiles` and `draftsReady` fields for the downstream planner.

## Safety and deduplication

- Hard maximum: 5 drafts per run, even if a larger target is requested.
- Diversity maximum: 2 drafts per campaign per run.
- Existing publication ledger, media receipts, and the previous renderer report are checked by draft path, output hash, and source-range fingerprint.
- Published, pending, previously rendered, or identical source ranges are not rendered again.
- Missing manifests, stale rights, path escapes, symlinks, invalid media, failed probes, and failed evidence extraction are explicit blockers.
- All reports declare `networkAccessUsed: false`, `paidAiUsed: false`, and `costUsd: 0`.

A `blocked` or `partial` report is an intentional safety outcome. Do not fill the daily target with undeclared ranges, downloaded media, stale campaigns, or duplicate material.
