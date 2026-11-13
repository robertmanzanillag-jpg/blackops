# Clippers Sleep Video Pipeline

This local-only pipeline creates long-form rain sleep videos from deterministic mathematical pad synthesis, seeded procedural rain, and a rights-verified local visual. It uses no network access, audio samples, paid APIs, or credentials.

## Production generation

FFmpeg and ffprobe must be available on `PATH`.

```bash
node script/clippers-sleep-video-generator.mjs \
  --output clippers_workspace/sleep/rainy-bedroom-sleep-8h05.mp4 \
  --duration-seconds 29100 \
  --seed 20260824 \
  --title "Rainy Bedroom Sleep — 8 Hours" \
  --visual-source /absolute/path/rainy-bedroom-night-v1.png \
  --visual-sha256 51c51ea89294778cfdd8ebc66f3b1450b60a5b559f23fd6e09cc821e73cca0c7 \
  --visual-rights-evidence /absolute/path/rainy-bedroom-night-v1.rights.json
```

The default and recommended runtime is 29,100 seconds (8:05). Production mode refuses durations below 28,800 seconds and refuses to start without all three visual arguments. The source and evidence must be regular files, not symlinks; the source must match the expected SHA-256; and the evidence must bind that same hash to an owned generated output with commercial use authorized and no third-party assets.

The soundtrack mixes a continuous pad composition with seeded, filtered procedural pink noise that behaves as soft rain. It has eight slowly crossfaded hourly harmonic evolutions and uses no recorded samples. The 16:9 visual receives a slow aspect-preserving crop, zoom, and pan without stretching. The generator writes to a temporary partial path, verifies it, and only then moves it to the requested filename. It preserves and refuses to overwrite any pre-existing partial master. The adjacent `.mp4.rights.json` separates procedural audio provenance from the SHA-linked visual evidence and records technical QA, seeds, parameters, hashes, and the eight-chapter plan.

This command **does not upload or publish anything**. The generated manifest documents provenance; it does not grant publication authorization.

## CI mode

Short videos are allowed only with explicit test mode and are capped at 30 seconds. Test mode may omit a visual asset and use the abstract procedural fallback:

```bash
node script/clippers-sleep-video-generator.mjs \
  --output /tmp/clippers-sleep-ci.mp4 \
  --test-mode \
  --duration-seconds 2 \
  --width 320 \
  --height 180
```

Focused test command:

```bash
node --test tests/clippers-sleep-video-generator.test.mjs
```

## Fail-closed gates

- production duration is at least eight hours;
- production has a regular, non-symlink visual source and rights-evidence file;
- the visual, expected hash, and evidence hash agree, with explicit owned/commercial rights and zero third-party assets;
- output has one H.264 video stream at the requested resolution;
- output has 48 kHz stereo AAC audio;
- measured duration is not shorter than requested;
- audio samples at 0h, every hour, and the closing segment are neither silent nor clipping;
- a video frame is decoded and hashed at every QA sample point;
- an existing output is preserved unless `--overwrite` is explicit;
- a pre-existing partial master is always preserved and blocks a new run;
- failed encodes or failed QA never become the final output;
- a rights/provenance manifest is written only after successful media QA.

## YouTube readiness notes

Official YouTube Help currently states that verified accounts can upload videos longer than 15 minutes, with a documented maximum upload size of 256 GB or 12 hours, whichever is less:

- https://support.google.com/youtube/answer/171664
- https://support.google.com/youtube/answer/71673

Monetization risk is handled fail-closed: YouTube says monetizable content must be original, non-repetitious, and commercially authorized for all audio and visual elements. This pipeline therefore records no external samples/assets, a deterministic seed, chapter-level variation, and `publicationAuthorizedByThisManifest: false` so a human channel review still has to happen before upload:

- https://support.google.com/youtube/answer/2490020
- https://support.google.com/youtube/answer/1311392

Before publishing, a separate reviewer must listen for comfort and clipping, inspect the visual result, confirm the target YouTube channel and authorization, and approve the title, thumbnail, description, and audience settings.
