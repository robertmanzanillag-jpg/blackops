# Bounded weekly Clippers execution

This change adds an explicit, resumable scheduling entrypoint for the four existing approved destinations. It does not install or launch a service, enable publishing, touch credentials, introduce model spend, change News/YouTube behavior or alter renderer bf771678. The common $100 API ceiling is not raised; these operations use local FFmpeg, deterministic metadata and the existing Metricool/Drive integrations.

## Two reviewed paths

**Same-day editorial clips:** after reviewing an actual output, the owner may add `editorialPolicy: 'evergreen_streamer_clip'` to its exact existing private prepare packet. Preparation carries that value into the approved asset and hashed review evidence. The immutable render request/receipt still supplies the exact source bytes, actual start and duration. Current same-day, five-minute lead, rights review within24h, source freshness≤72h at publication, commercial/network/membership/disclosure/quality checks remain unchanged. This is not a future-date or stale-source exception, and adding a tag to arbitrary model JSON grants no permission.

**Future evergreen clips:** the original private render request must contain `weeklyAuthorization` BEFORE rendering. Its entire content is fingerprinted by the unchanged engine. Existing requests/receipts cannot be relabelled, retimed, overwritten or retroactively given this exception. The authorization and referenced owner-only license receipt must bind exact destination/network, source bytes and original publication date/URL, exact scheduledAt, current permission observation, terms/basis/membership, commercial disclosure and the reviewed window≤7NY calendar days. Missing or invalid proof holds. Source must still be under72h at actual rendering. A source already too old to render remains held with bf77.

`rights.validUntil` is an internal reviewed authorization ceiling, never an invented license-expiry date. The license receipt separately states `permissionExpiresAt` (null only when no expiry is stated by the reviewed source). A stated permission expiry before scheduledAt rejects the asset. Open-ended permission does not erase campaign conditions or revocation checks. The operator must recheck actual conditions before dispatch; membership may only be `not_required` when the actual public permission allows it, not to bypass a campaign gate. Permission for TikTok never transfers to Facebook.

## Future authorization format

The same-day path needs no new weekly authorization file. For future dates use a new request ID and these fields; every approval is supplied by the trusted owner workflow after primary-source and media review:

```js
request.weeklyAuthorization = {
  schemaVersion: 1, contentClass: 'evergreen_streamer_clip',
  destination, sourceSha256, sourceUrl, sourcePublishedAt,
  scheduledAt, windowStart: '2026-11-18', windowEnd: '2026-11-22',
  observedAt, validUntil, reviewedBy,
  termsUrl, sourceScope: 'exact_asset', commercialPermission: 'approved',
  basis, membership, ownership, // ownership:'verified' is required for owned media
  permittedNetworks, thirdPartyCommercial,
  licenseEvidenceSha256 // SHA256(JSON.stringify(parsedLicenseReceipt))
};
```

Store that receipt at owner0600 `config/clippers-daily-learning/rights-evidence/<digest>.json`. Its fields are `schemaVersion:1`, `kind:'reviewed_exact_asset_license'`, the same destination/source URL/SHA/original date/terms/basis/membership/ownership/network/disclosure/current review/validUntil fields above, `permissionExpiresAt`, and actual `reviewedBy`. Keep all primary permission conditions, scope and retained evidence digests in this receipt; hash-shape validation does not authenticate model claims or replace human/source review. Optional fields are included in the receipt digest. Exact matching is required; copied receipt evidence cannot change network, source or slot.

For a spatially framed derivative, request.sourceSha256 is the honest derived full-source hash. The original request's `sourceProvenance` preserves schemaVersion1, originalSourceSha256, derivedSourceSha256, canonicalVideoId, originalSourcePublishedAt, actual crop geometry, transformReceiptSha256 and audited timelinePreserved/audioPreserved. The source must retain its entire original timeline/audio; precutting cannot pretend start0 is the original episode interval. Source/probe/transform evidence must be independently checked, not generated booleans. Future license receipt additionally binds `originalSourceSha256` and `sourceProvenanceSha256 = SHA256(JSON.stringify(request.sourceProvenance))`. The unchanged engine fingerprints this provenance. No output can be edited after its receipt is produced.

## Duration and duplicate rules

Use the existing prospective `duration` candidate-manifest/experiment path for a complete editorial unit5–90s: review a new candidate version that changes only duration, and bind its exact experiment/version in the request before render. Do not alter active baseline30, fabricate actualParams/receipts, pad/truncate to make a sentence fit, or claim an improvement from this unbalanced pilot. Normal paired-learning gates remain intact.

For explicitly reviewed evergreen assets, duplicate checks use immutable actual source interval `[startSeconds,startSeconds+actualParams.duration)` and source SHA, canonical original video identity and preserved original SHA. Overlaps, repeated intervals and reencodes/crops of the same interval are rejected per destination. Source URL aliases cannot evade this check. A previous delivery without a verified interval keeps conservative URL/canonical-original blocking. IDs/media/caption/time and same local-hour duplicates remain rejected; two different minutes in one NY hour are not separate daily hours. Default untagged behavior keeps the original URL rule. Cross-destination reuse still needs independently scoped rights/media/render receipts.

## Invocation and safety

Run the reviewed CLI as its own child process, never inline in the BlackRoom daemon:

```
node script/clippers-weekly-scheduler.mjs --start 2026-11-18 --end 2026-11-22
node script/clippers-weekly-scheduler.mjs --start 2026-11-18 --end 2026-11-22 --apply
```

Report-only is default. `--apply` additionally requires the existing private approved-input.publish=true; it does not set that flag. There is no new key, publishing capability, service schedule or environment toggle. Empty/no-valid-assets paths make no provider/credential call. `ready` means locally reviewed and ready for live preflight, not provider-scheduled coverage. Private report is `reports/clippers-daily-learning/weekly-latest.json`. The read-only Office projection consumes actual weekly GET-evidence records from the existing state, keeps their original confirmation timestamps and suppresses invalid proof/career outcomes. It does not infer success from ready previews or renew evidence when merely reread. Actual target still requires5videos/day per exact account and distinct allowed local hours; current baseline slots are11/13/15/17/19NY, not personalized best-time claims.

The existing due daily watchdog runs a narrowly scoped weekly child between preparation and daily learning only when existing owner-approved input.publish=true and explicit editorial/weekly assets are present. Otherwise no child/provider call is added. It derives the remaining NY week and uses the same asset/rights restrictions; no extra publishing flag, service or schedule is introduced. The child has an8minute deadline, bounded stdout and process-group termination with250ms escalation; unknown failure retains scheduled=null and private receipts for reconciliation. Models/API keys, Metricool tokens and unrelated secrets are not forwarded; the child loads its own Metricool credentials from the existing config-root helper only if valid assets actually need dispatch.

The weekly mode shares the existing metricool-autopilot lock and delivery state, preserves state.day and all learning/metrics history, and can resume after that day's metrics ran. Every dispatch revalidates immutable proof and current review after preflight. Preparation retains120s/20packet limits, keys reservations by actual scheduled NY day, and prioritizes not-yet-queued packets so recent ready packets cannot starve later weekly batches. Scheduling is bounded to20attempts/cycle,8minutes,100attempts for the stable New York calendar week (the authorized remaining Nov18–22 window has exactly100maximum slots); changing CLI start/end or the daily remaining-week start cannot reset that counter. Cross-Sunday execution windows reject; a future full seven-day140-slot policy would need an explicit reviewed quota change; existing deliveries and unresolved attempts reduce capacity, not just newly successful writes.

Immediately before dispatch the production adapter rereads actual REST calendar rows for that exact account/day. Today it also reads actual account analytics over NY midnight→now, verifies publication time/identity, deduplicates public post IDs and reconciles published calendar entries. Empty analytics alone is never a historical success receipt or an assertion no new posts exist. Counts represent fresh observed provider coverage; external posting/connector lag remains a provider limitation, so serialize all publishing activity and reconcile ambiguity. Unsupported status/time/identity, documented page.next or other pagination markers hold instead of silently treating a partial list as complete. The connector's pending-only description is not used to redefine the REST endpoint; official Swagger permits PUBLISHED provider rows. A locally acknowledged delivery absent from current provider evidence holds for reconciliation.

Before POST, persist verification_pending plus normalized actual preflight evidence/digest. After POST the adapter verifies exact ID/date/content/network/media via GET, and the weekly executor explicitly confirms again, retaining schedule evidence/digest. Only then increment scheduled. POST-only acknowledgements, timeouts and lost responses stay unknown. No automatic duplicate POST, upload or retry occurs. Errors and the CLI8minute hard deadline report sanitized codes and retain pending receipts/locks for explicit reconciliation; never delete an unknown lock or reservations automatically. Install dependencies before entrypoints. Keep source and runtime changes PR-first; root/operator alone applies reviewed exact hashes and activates operations after QA/CI.

Rollback: stop invoking the new weekly CLI and revert these source changes with the usual backup/hash checks. Preserve attempt/delivery/rights/media receipts and unknown states; reverting code must not erase a possibly executed provider operation. Existing scheduled posts are not cancelled or changed by rollback.
