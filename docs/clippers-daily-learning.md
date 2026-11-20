# Daily Clippers learning and publishing

The 10:00 America/New_York Clippers watchdog runs the gaming portfolio cycle once per local calendar day. It uses the existing workspace, Metricool account and worker lock. YouTube delivery, motivation and sleep stay on their own workers. The 07:00 TikTok worker still runs its existing account configuration.

| Metricool brand | Exact destinations |
| --- | --- |
| 6431685 | TikTok @streamersus (legacy ledger name: streamersclips) |
| 6431687 | TikTok @streamersclipusa |
| 6591612 | TikTok @news305miami (legacy: ynb4b6r6) and Facebook page 1193011863901514 |
| 6595747 | Held while no destination is connected |

The adapter verifies the destination identity with Metricool and checks explicit posting capability or verified owner access, today's scheduled count and duplicates before every scheduling write. The daily cap is five per exact destination. The gaming portfolio cannot select KONG, kong.app or Black Room. The legacy news sender excludes the four portfolio brand IDs even when an old override or alias matches. Existing news accounts outside that set retain their current eligibility checks.

## Evidence and operation

The local operator can place `approved-input.json` in `$CLIPPERS_WORKSPACE_ROOT/config/clippers-daily-learning/`. Use the existing local OS account and owner-only files (mode 0600). A missing packet is a zero-spend, no-provider hold. Existing marketplace research files and unscreened drop folders confer no authority. An approved packet has `schemaVersion: 1`, `publish` and `collect` flags, and `assets` and `reviews` arrays. An asset requires:

- The exact `brandId`, `network` and `account`, stable `id`, `campaignId`, `sourceId`, `creator`, language, `sourceUrl` and offset-bearing `sourcePublishedAt`.
- `rightsObservedAt` within 24 hours, `rightsValidUntil` through the scheduled slot, a source under 72 hours at that slot, and a future `scheduledAt` on the cycle date.
- A reviewed `caption` and explicit `thirdPartyCommercial` flag, `mediaUrl`, `mediaSha256`, `draftFile` and matching `mediaReceiptFileId` in the existing uploader receipt ledger. The receipt must be ready, explicitly zero incremental spend, and match the exact Google Drive download ID.
- `policyVersion` (initially `baseline-1`). For an experiment, include `experiment` with `id`, `context`, `variable` (hook, duration, caption_layout, crop or posting_slot), `arm` (control or candidate), `baselineVersion` and `candidateVersion`.

Each asset references `evidenceSha256`, the lowercase SHA-256 of `JSON.stringify(reviewedEvidence)`. Store the reviewed evidence as `evidence/<evidenceSha256>.json` in that same owner-only config tree. The evidence repeats the exact source, campaign, media, caption, schedule, language, creator, policy version, experiment and rights times from the asset, with `assetId` and `destination` (instead of the asset's `id` and top-level destination). It also has the independent evidence fields below.

| Field | Required value |
| --- | --- |
| `termsUrl` | Actual source/campaign terms HTTPS URL |
| `commercialPermission`, `sourceScope` | `approved`, `exact_asset` |
| `rightsBasis`, `membership` | `campaign` with `verified`, or `public_policy` with `not_required`. An `owned` source requires `not_required` plus `ownership: "verified"`. |
| `quality`, `originalEdit`, `disclosure` | `passed`, `verified`, `verified` |
| `reviewedBy` | Operator-recorded reviewer |
| `authorizedSpendUsd`, `providerIncrementalCostUsd` | `0`, `0` |

The operator records these facts after verifying the asset, campaign membership, current terms, exact commercial scope for the destination, media and disclosure. The account connection or a public campaign listing alone is insufficient. There is no authority derivation from external market research. Use `node script/clippers-daily-learning.mjs` only against a dedicated fixture workspace until QA authorizes activation.

## Metrics, decisions and rollback

The worker saves attempts before calling Metricool. A missing response or proof leaves a verification-pending attempt; it is reconciled against the remote schedule and never blindly resent. Only matching remote content, a scheduled receipt and a verified public post with provider-supplied publication time qualify for analytics. Metricool-hosted media that differs from the reviewed Drive URL has to match the original SHA-256 before confirming the schedule. Analytics require the exact platform post ID and platform views. Metrics with only a retrieval timestamp are retained as observations. A provider observation timestamp and completion are both required for comparison. Missing values stay missing, and closed windows with no observation are counted as missed.

The daily cadence captures age windows [24h, 48h), [72h, 96h) and [168h, 192h). Each observation retains its real timestamp, and comparisons group rows by one-hour observation age within each window as well as destination, language, creator, exact experiment/context and baseline/candidate version. Five distinct public posts per variant, at least 20% median views lift and at most 10% relative completion decline yield a candidate finding. This is a comparison heuristic.

An activation review in the owner packet must name `id`, `reviewer`, `authorizedBy` (different operator identities), exact `destination`, `action: "activate"`, `from`, `to`, exactly three disjoint comparison IDs and `evidenceDigest` (the SHA-256 of the sorted comparison ID array serialized with JSON.stringify). Activation also requires no completion or measured latency regression and two strict completion improvements. The report separates findings, approved-media queue activation and the first observed outcome after that queue change. An observed outcome does not by itself establish performance improvement. These are local operator records secured by the host account and file permissions; they are not individual cryptographic signatures.

To roll back a destination, add an independently reviewed and owner-authorized `action: "rollback"` record using a new `id`, exact active `from`, previous `to` and the same `evidenceDigest` from the last activation. The previous version again controls which already-rendered assets qualify for future publication. The prior decisions stay in history. Existing scheduled or published posts remain visible for operator review.

## Destination-aware rendering

The existing 07:00 TikTok renderer and the YouTube, motivation and sleep workers are unchanged. Portfolio rendering is explicit for an approved local source and exact destination. Experiments and non-baseline portfolio assets require real render receipts. A manually edited baseline can pass the existing checks before a renderer manifest is pinned. A reviewed rollback to the baseline reinstates the pinned manifest and requires its render receipt.

Use `node script/clippers-portfolio-render.mjs --engine-sha` to print the exact renderer source digest. Store each reviewed manifest in `$CLIPPERS_WORKSPACE_ROOT/config/clippers-daily-learning/render-policies/<brandId>__<network>__<account>/<version>.json` in an owner-only file. A manifest has `schemaVersion: 1`, exact `destination`, `version`, `engineSha256`, `reviewedBy`, and these `params`:

| Feature | Parameters applied |
| --- | --- |
| `hook` | Source time offset in seconds, added to the approved source cut start |
| `duration` | Output duration in seconds |
| `crop` | `left`, `center`, or `right` for the 9:16 crop |
| `caption_layout` | `off`, `upper`, or `lower` with the approved overlay text |
| `posting_slot` | One to five permissible America/New_York delivery times in 24-hour `HH:mm` format (one string or an array of distinct strings) |

Create an owner-only `render-requests/<id>.json` under the same config tree with `schemaVersion: 1`, exact destination fields, `id`, `policyVersion`, relative `sourceFile`, file `sourceSha256`, `sourceStartSeconds`, optional `captionText` and optional experiment assignment. The nested `rights` record binds the same source hash and exact destination, includes `basis`, `membership`, `sourceScope`, `commercialPermission`, `reviewedBy`, `termsUrl`, `sourcePublishedAt`, `observedAt`, and `validUntil`, and requires `ownership: "verified"` for owned sources. Use the same authorized values described for publication evidence above.

Run `node script/clippers-portfolio-render.mjs --request <id>` with `CLIPPERS_WORKSPACE_ROOT` pointing at the intended workspace. The renderer reads the active version from the portfolio state, or selects the reviewed experimental arm only when the two manifests differ in the named feature alone. It runs local FFmpeg and ImageMagick, verifies dimensions, audio and duration, and writes an output SHA with the exact parameters and engine checksum. This command does not upload or publish. It requires FFmpeg/ffprobe, and caption overlays require ImageMagick with Arial-Bold, as does the legacy rendering path.

For publication approval, use the finished `draftFile` and `outputSha256` with an exact-destination, owner-only receipt in `reports/clippers-daily-learning/portfolio-media-receipts.json` and add the returned `receiptSha256` as `renderReceiptSha256` to the upload receipt, asset and reviewed evidence. The queue rechecks the local media bytes, engine code, version digests, exact experiment, destination and posting slot before an adapter can receive it. A posting-slot experiment requires a time unique to its assigned arm. Review and rollback pin both the exact version and render manifest. A version activation remains a workflow step, and the first observed result does not establish an improvement.

Local state and the latest report are under `reports/clippers-daily-learning/`. The existing factory-wide `reports/metricool-autopilot.lock` prevents overlapping scheduling; after a crash verify neither worker is running before releasing a stranded lock. Reports can show missing rights, permissions, provider analytics or schedule proof. Provider schema or connection changes are held for verification. No permission expansion or additional spending is implicit in qualification, review or rollback.

Metricool references: [API authentication and brand ID lookup](https://help.metricool.com/common-questions-and-errors-when-using-the-api-8x9nq) and [supported scheduling networks](https://help.metricool.com/faqs-about-the-metricool-mcp-1i3w0).
