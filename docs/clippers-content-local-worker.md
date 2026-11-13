# Clippers Content Local Worker

This standalone local orchestrator prepares the new YouTube content lanes without networking, uploads, publishing, credentials, paid services, Marketplace, Metricool, or TikTok. It runs the fact-only content-learning CEO, then renders at most five approved motivation candidates for each independent Spanish and English channel. Sleep generation is capped at one artifact per rolling seven days.

## Configuration

The worker accepts exactly one explicit configuration file. Production should use:

`~/.local/share/blackops/clippers-workspace/config/clippers-content-worker.json`

All operational paths must remain inside `workspaceRoot`. The configuration must be a regular, readable file rather than a symlink.

```json
{
  "schemaVersion": 1,
  "workspaceRoot": "~/.local/share/blackops/clippers-workspace",
  "metricsLedger": "reports/clippers-content-publication-metrics.json",
  "reportDir": "reports/content-worker",
  "operationTimeoutMs": 50400000,
  "motivation": {
    "es": {
      "channelId": "motivation-es",
      "manifestFiles": ["motivation/manifests/es-001.json"],
      "gates": { "accountVerified": true, "rightsStatus": "owned", "qualityPassed": true, "candidatesReady": true }
    },
    "en": {
      "channelId": "motivation-en",
      "manifestFiles": ["motivation/manifests/en-001.json"],
      "gates": { "accountVerified": true, "rightsStatus": "owned", "qualityPassed": true, "candidatesReady": true }
    }
  },
  "learning": {
    "maximumMetricsAgeHours": 72,
    "laneGates": {
      "sleep_long": { "accountVerified": true, "rightsStatus": "owned", "qualityPassed": true, "candidatesReady": true }
    }
  },
  "sleep": {
    "enabled": true,
    "jobs": [
      {
        "output": "sleep/rendered/2026-08-24-rainy-bedroom-8h05.mp4",
        "adoptExisting": true,
        "durationSeconds": 29100,
        "seed": 20260824,
        "title": "Rainy Bedroom Sleep — 8 Hours",
        "visualSource": "sleep/source-assets/rainy-bedroom.png",
        "visualSha256": "REPLACE_WITH_64_CHARACTER_SHA256",
        "visualRightsEvidence": "sleep/source-assets/rainy-bedroom.rights.json"
      },
      {
        "output": "sleep/rendered/2026-08-31-deep-rain-8h05.mp4",
        "durationSeconds": 29100,
        "seed": 20260831,
        "title": "Deep Rain for Sleep — 8 Hours",
        "visualSource": "sleep/source-assets/deep-rain.png",
        "visualSha256": "REPLACE_WITH_64_CHARACTER_SHA256",
        "visualRightsEvidence": "sleep/source-assets/deep-rain.rights.json"
      }
    ]
  }
}
```

### Adopt an already approved master without rerendering

`adoptExisting: true` is an explicit, per-job migration gate for a completed master that was produced by `clippers-sleep-video-generator.mjs` before the content worker recorded it. It never means “trust any file at this path.” The worker accepts the existing MP4 only when all of these checks pass locally:

- the MP4, its adjacent `.rights.json`, the visual source, and the visual-rights file are regular files whose real paths remain inside `workspaceRoot`; symlinks and path escapes are rejected;
- no `.partial.mp4` exists;
- the streamed MP4 SHA-256 matches the generator rights manifest and the manifest points back to that exact MP4;
- the generator manifest records production output, zero external audio samples, zero paid services, no required network access, owned generated visual rights, no third-party assets, publication still requiring review, and passed generator QA with valid sampled media;
- the configured visual path/hash/evidence exactly match the manifest, and both visual and evidence files are re-hashed;
- a fresh local `ffprobe` confirms MP4 video and audio streams, landscape dimensions, matching codecs/audio properties, matching dimensions and duration, and at least 28,800 seconds (8 hours).

On success, the worker does not call the renderer. It writes the same `sleep.result.status: "generated"`, `outputPath`, and `manifestPath` contract consumed by the YouTube upload packager, plus `adoptedExisting`, the rechecked output hash, duration, and validation summary. The same row is atomically added to the sleep ledger, so the normal rolling seven-day cap immediately deduplicates subsequent runs. Reports continue to state `networkUsed: false`, `uploadAttempted: false`, and `apiCostUsd: 0`.

Without `adoptExisting: true`, pre-existing output, manifest, or partial artifacts remain fail-closed: the worker never silently adopts, overwrites, uploads, deletes, or spends money on them.

Candidate manifests still pass every rights, voice, media, quality, channel-language, daily-volume, and deduplication gate in `clippers-motivation-shorts.mjs`. A plan of five does not bypass those gates. On later days the worker walks the configured queue, skips already-rendered candidates, and continues until it renders the daily target or exhausts the approved queue; it never fills with an unapproved candidate. The report records exact rendered shortfalls against five for each channel.

Run:

```sh
node script/clippers-content-local-worker.mjs --config /absolute/path/clippers-content-worker.json
```

The production atomic owner-only report is `reports/content-worker/clippers-content-local-worker-latest.json`. The live lock is beside it as `clippers-content-local-worker.lock`; a live PID always wins regardless of lock age. The owner-only sleep generation ledger is also beside it as `clippers-content-sleep-ledger.json`. Each sleep job has a unique explicit output, title, seed, visual hash, and evidence path. After the seven-day cap expires the worker selects the next unused job rather than overwriting the previous week's artifact. When the rolling cap is already satisfied, the report preserves `requestedByCeo: 1` but records an effective `planned: 0`, `shortfall: 0`, and a `deduplicated` result so monitoring does not raise a false daily alert. Default operation timeout is 14 hours and can be configured from one minute up to 24 hours.
