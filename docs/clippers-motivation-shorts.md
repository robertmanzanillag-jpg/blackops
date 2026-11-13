# Clippers Motivation Shorts

This zero-cost local lane renders original Spanish or English motivational scripts into 20–40 second, 9:16 MP4 drafts. It never publishes. The initial selection target is five strong Shorts per channel per day (five ES and five EN); the hard ceiling is five rendered pieces per independent `channelId` per America/New_York day. A rejected candidate is never replaced with weak quota filler.

## Fail-closed inputs

Every draft requires a version 1 JSON manifest and exactly one audio mode:

- `local_voice` (also inferred for backward-compatible manifests containing `voice`): an audio-only local voice recording. The separate voice evidence JSON must match the short ID, relative file path, and SHA-256, and must document speaker consent and commercial-use authorization.
- `procedural_original`: a deterministic, non-melodic pink-noise sound bed made locally by FFmpeg. This text-led mode has no voice file, external audio, TTS, network request, paid service, or separate voice-rights file. Its complete seed, filter parameters, generator version, and provenance declaration are recorded with the output.

The manifest must always declare an original, owned script with no third-party quotes, speeches, or sources. Mixed audio modes, remote TTS, web audio, attributed speeches, missing evidence in voice mode, symlinks, path traversal, and mismatched hashes are rejected.

Example manifest:

```json
{
  "schemaVersion": 1,
  "shortId": "motiva-001",
  "channelId": "motivation-es",
  "language": "es",
  "format": "youtube_short_9x16",
  "script": {
    "hook": "No necesitas sentirte listo para comenzar.",
    "beats": ["Da hoy un paso pequeño.", "Cumple la promesa que te hiciste."],
    "close": "Empieza ahora.",
    "originality": {
      "status": "owned_original",
      "author": "Equipo Clippers",
      "thirdPartyQuotes": false,
      "thirdPartySpeeches": false,
      "sources": []
    },
    "structure": { "conflict": "hook", "idea": "beats", "action": "close" }
  },
  "voice": {
    "sourceType": "local_recording",
    "file": "input/motiva-001.wav",
    "rightsEvidenceFile": "rights/motiva-001-voice.json",
    "sha256": "<64 lowercase hex characters>"
  },
  "style": { "backgroundColor": "#111827" },
  "contentSafety": {
    "celebrities": false,
    "podcasts": false,
    "clonedVoices": false,
    "thirdPartyQuotes": false,
    "wealthPromises": false,
    "healthPromises": false
  },
  "qualityGate": {
    "approved": true,
    "hookFirstSecond": true,
    "actionable": true,
    "noQuotaFiller": true,
    "reviewedBy": "Robert",
    "reviewedAt": "2026-08-24T12:00:00.000Z"
  }
}
```

For a text-led Short that has no narration, replace `voice` with:

```json
{
  "audio": {
    "mode": "procedural_original",
    "durationSeconds": 24,
    "seed": 20260824,
    "parameters": {
      "noiseColor": "pink",
      "amplitude": 0.12,
      "highpassHz": 55,
      "lowpassHz": 3800,
      "volumeDb": -14,
      "fadeSeconds": 1
    },
    "provenance": {
      "status": "owned_original",
      "generator": "ffmpeg_lavfi_anoisesrc_v1",
      "thirdPartyAssets": false,
      "networkUsed": false,
      "paidCostUsd": 0
    }
  }
}
```

Only the listed procedural fields are accepted. Pink noise is filtered and faded but remains deliberately non-melodic. Change the seed to create a separately documented original realization; reusing an identical audio plan is deduplicated.

The voice evidence schema is:

```json
{
  "schemaVersion": 1,
  "assetType": "voice_recording",
  "shortId": "motiva-001",
  "file": "input/motiva-001.wav",
  "sha256": "<same SHA-256 as the manifest>",
  "rightsStatus": "owned",
  "speakerConsent": true,
  "commercialUseAuthorized": true,
  "provenance": "local_recording",
  "verifiedBy": "Robert",
  "verifiedAt": "2026-08-24T12:00:00.000Z"
}
```

`rightsStatus` may be `owned` or `explicitly_authorized`.

## Run

```bash
node script/clippers-motivation-shorts.mjs \
  --workspace /absolute/path/to/clippers-workspace \
  --manifest manifests/motiva-001.json
```

Each channel is language-stable: once a ledger contains a language for a `channelId`, a manifest in another language is rejected. ES and EN channels have separate daily counters. There is no global or rolling-seven-day cap.

The editorial structure is explicit: conflict in the hook, core idea in the beats, and one practical action in the close. Celebrity or podcast material, cloned voices, third-party quotes, and wealth or health promises are explicitly excluded. Each piece must also pass the explicit quality gate: first-second hook, actionable close, named reviewer, and `noQuotaFiller: true`.

The renderer uses only local `ffmpeg`/`ffprobe` and ImageMagick. It creates a deterministic visual plan from the owned procedural-audio seed (or a local hash for authorized voice): animated multi-color gradients, a subtle grid and light sweep, a first-second accent, a progress indicator, and gently moving caption cards. Six fixed theme families give real seed-based variation without downloading or importing stock media.

Caption cards keep their text inside explicit Shorts safe zones, with a small context label, a large main message, high-contrast backing, and separate hook/beat/action hierarchy. The first caption and accent are visible at time zero; the hook emphasis ends at 0.9 seconds. The progress bar sits above the reserved lower UI area. The exact visual plan, generator version, theme, motion values, safe zones, provenance declaration, and SHA-256 are recorded with every output.

The only visual filter families emitted by the plan builder are the local FFmpeg `gradients`, `vignette`, `drawgrid`, `drawbox`, and `overlay` filters. Caption cards are built with fixed ImageMagick primitives and local Arial Bold. No URL, external file, third-party asset, generative API, voice clone, TTS, or paid service is accepted or used. The renderer verifies audio plus 1080×1920 video and duration, and extracts start/middle/end evidence frames. Provenance is stored under `evidence-drop/motivation/<channel-id>/<short-id>/`; deduplication records are stored in `reports/clippers-motivation-ledger.json`. The ledger hashes the script, manifest, output, visual plan, and either the authorized voice or exact procedural audio plan. API cost is always USD 0 and `publishEnabled` is always false.

No package script was added; integration may call the `.mjs` entrypoint directly or add a package command separately.
