# Portfolio media preparation

`script/clippers-portfolio-prepare.mjs` connects the optional portfolio renderer
to the existing Google Drive OAuth/connector uploader and the daily scheduler's
approved asset input. It does not collect sources, grant media rights, enable
the publisher or post to a social network.

The exact allowlist remains `6431685/tiktok/streamersus`,
`6431687/tiktok/streamersclipusa`, `6591612/tiktok/news305miami` and
`6591612/facebook/1193011863901514`. New York's disconnected brand is not a
destination. KONG and Black Room are never admitted.

## Reviewed inputs

1. Use the renderer's owner-only render request and destination-specific policy
   manifest to create an actual local MP4 and immutable render receipt.
2. Review that output and its rights for the exact network. An owner-only
   `config/clippers-daily-learning/prepare-requests/<requestId>.json` must bind
   the semantic JSON SHA-256 of the render request, render receipt SHA-256,
   output SHA-256 and exact destination. It also supplies campaign/source IDs,
   source URL, creator/language, caption, scheduled time, commercial disclosure
   and explicit public-upload/asset approval.
   The render receipt also binds the complete render-request JSON digest,
   source byte SHA, actual seek offset and caption-text digest. Changing a
   request never rewrites its old receipt; use a new request ID when needed.
3. The render request's rights must include `permittedNetworks` and
   `thirdPartyCommercial`. Its commercial permission, exact-asset scope,
   source SHA, current observation, permission expiry and campaign membership
   or explicit public-policy/owned basis are checked again. Permission must
   cover the scheduled time; the source must still be at most 72 hours old then.

The prepare packet uses `schemaVersion:1`, `id`, `destination`,
`renderRequestSha256`, `renderReceiptSha256`, `outputSha256`, `campaignId`,
`sourceId`, `sourceUrl`, `creator`, `language`, `caption`, `scheduledAt`,
`thirdPartyCommercial`, `reviewedBy`, `quality:"passed"`,
`originalEdit:"verified"`, `disclosure:"verified"`,
`publicUploadAuthorized:true`, `schedulerAssetAuthorized:true`,
`authorizedSpendUsd:0` and `providerIncrementalCostUsd:0`.

These fields are trusted owner attestations, not self-authenticating booleans.
Files must belong to the current OS owner, have mode 0600, and not be symlinks
or hardlinks. Research/collector metadata cannot approve an asset. The maker's
restricted source workspace must not include these configuration directories.

## Operation and boundaries

By default the command returns disabled/readiness indicators without reading
credential files or calling a provider. Operation requires both
`CLIPPERS_PORTFOLIO_PREPARE_ENABLED=true` and the existing
`CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED=true`, plus the reviewed packets.
The existing Google OAuth/connector path is reused; no key is provisioned.
The existing system owner (`DEFAULT_USER_ID`) and a usable installed `tsx`
loader are required before an upload is reserved. The helper receives only
Drive OAuth/connector, database and owner configuration; paid model, Maps,
Metricool and YouTube keys and inherited Node hooks are excluded.
`CLIPPERS_CONFIG_ROOT`, when provided to the actual Drive helper, selects the
existing credential configuration loader. No credential values are printed.

Only already reviewed render receipts are consumed. The command does not
rerender those videos. A cycle is capped at 120 seconds and 20 usable packets, with
five slots per exact destination/day, unique slots and no repeated media or
caption within that destination. Calls to the existing Drive helper run in
separate processes capped at 30 seconds or the remaining cycle budget.
Each helper also has its own 30-second deadline if the parent disappears.
Existing staging directories are checked as owner-private and their parent
chain must be owner-controlled and not writable by other users. Staged files
must be owner-only, single-link regular files with the reviewed hash. Unsafe
pre-existing permissions block before upload; the worker does not change them.
The scan considers the 500 most recently modified packets; stale or invalid
packets do not consume the usable-packet allowance. Keep the active request
directory below 5,000 entries by retaining expired packets in an owner archive;
an oversized directory reports an explicit retention blocker.

Each upload is durably reserved before any remote write. Lost upload
acknowledgements remain `upload_unknown`; the worker does not try another
upload. A known file whose sharing acknowledgement was lost can only be
reconciled by an unauthenticated exact-byte public read. It is never blindly
shared again. All Google download redirects are host-restricted and bounded.
Mutating Drive helpers additionally claim a per-hash/per-operation file with
exclusive creation. They require the live parent's PID and nonce, expected
upload state and folder/file ID. Calling a helper twice cannot repeat a write,
even when an acknowledgement was lost. Known scheduler conflicts are rejected
before creating folders or exposing media.

One content-addressed Drive file can serve several separately approved
destinations. Each receives its own private, render-bound receipt in
`reports/clippers-daily-learning/portfolio-media-receipts.json`. The adapter
then writes hash-bound evidence and appends the asset to `approved-input.json`
under the scheduler's existing lock, preserving its `publish`, `collect` and
review settings. It never turns publishing on. The upload journal is separate
from the legacy uploader and no YouTube, motivation, sleep or news flow changes.

Run this optional predecessor before the daily learner, not while holding its
`metricool-autopilot.lock`. The parent integration owns enabling that hook.
With no reviewed source assets, the correct result is zero prepared clips.

## Verification and rollback

`node --test tests/clippers-portfolio-prepare.test.mjs` uses original synthetic
local video and a fake Drive adapter. It exercises all four destinations, one
shared upload, exact scheduler admission, missing rights, lost acknowledgements,
deadline, duplicate slot and public-byte verification. No real upload or post
is made. FFmpeg/ffprobe are required for the real-render cases.

Disable the optional prepare flag to stop new work. Reverting this PR removes
only the adapter; existing Drive files, receipts and scheduled posts remain.
There is no automatic public-file deletion or duplicate retry during rollback.
If the process dies while holding `portfolio-prepare.lock`, inspect its recorded
PID and the per-hash journal before an operator removes that mutex. Removing a
stale mutex does not clear an unknown upload reservation or authorize a replay.
