# KONG repair subscription maker

This local worker consumes the private KONG repository's original, unedited,
owner-authored software repair issues. It uses the existing signed-in GitHub and
ChatGPT/Codex memberships. It does not need a new OpenAI API key or a local copy
of the server's HMAC credential. Existing HMAC RPC helpers are tested but are not
the enabled CLI transport.

## Admission and execution

The canonical source marker and SHA-256 digest must agree with the issue body,
the recomputed source task/error/generation repair key, company `kong`, exact
repository `robertmanzanillag-jpg/kong-nightlife`, and release branch
`codex/kong-production-recovery-20261117`. GitHub's `lastEditedAt` must be null.
The worker does not use GitHub `main`: its history is not the current production
release lineage. It checks the live release head against the approved immutable
source SHA before preparing, before invoking the model and before publication.
Changed release heads hold the generation instead of silently rebasing it.
Source admission also requires sanitized typed error evidence (concrete class,
message and source location), a reviewed parent engine commit, and an explicit
regression scenario. Preflight checks these live prerequisites before creating
any journal or irreversible claim; stale unclaimed generations remain held.

An atomic create-only `codex/repair-claim/<repair-key-digest>` Git ref prevents
multiple makers from taking the same generation. The ref is never force-pushed
or deleted. Local 0600 journals record every potentially ambiguous write before
it occurs. Lost acknowledgements never trigger another model run or duplicate
PR. Other independent generations remain eligible. A stale lock or uncertain
journal requires reconciliation; do not delete either to force a replay.

The model receives a filtered source copy, without Git history, environment
files, credentials, nested worktrees or deployment configuration. Source files
containing recognizable credential patterns are omitted and cannot be replaced
by the maker. Oversized baseline data exports are likewise omitted and protected,
so a large unrelated JSON manifest does not block every repair or become a
deletion. Repairs requiring an omitted input stay outside this bounded scope.
A named Codex
permission profile denies filesystem reads outside the workspace (except minimal
runtime paths), denies command network access, and keeps dependencies read-only.
A live OS sandbox probe must successfully write in the workspace and fail to
read a harmless outside canary before model execution. The signed-in CLI's
service traffic is separate from sandboxed command traffic.

Dependency preparation is a separate sandboxed deterministic stage: only
integrity-pinned HTTPS packages from `registry.npmjs.org`, with lifecycle scripts,
audit and funding requests disabled. The model has no GitHub or provider keys in
its environment, no inherited user configuration, and no live search. Nested
model agents, hooks and plugins are disabled for this bounded maker process.

Simple work uses explicitly selected `gpt-6-luna` with low reasoning. A bounded
security/auth/payment/concurrency repair uses `gpt-6.1-sol` with medium reasoning.
The checker chooses its tier from actual changed paths and diff as well as error
evidence, so an innocuous summary cannot hide a payment or authentication edit.
There is one maker attempt per generation, a 15-minute maker deadline, a
10-minute fresh checker deadline, and at most three reserved model invocations
(both roles counted) per America/New_York calendar day. Two free reservations
are required to admit a new generation. No stronger
model retry, API fallback, credit purchase or automatic budget increase exists.
The installed CLI catalog and sign-in were checked without making a model call;
catalog presence does not prove remaining subscription quota. CLI quota failures
remain failed work. No savings or productive improvement is inferred from them.

## PR and checking

Only bounded code, test and documentation changes can be copied to the checkout.
Package/config/policy/credential changes, symlinks and secret-like added content
are rejected. At least one changed regression test must run with Node 22 through
the same sandbox on a newly materialized copy of exactly the publishable files,
with one or more passing test cases and zero failures. Maker temp helpers cannot
enter this copy. Its source digest must remain unchanged after testing and match
the actual committed candidate presented to the checker. This is
a maker check, not an independent acceptance gate.

Model- and test-owned files are first frozen by a trusted deterministic copier
inside the OS sandbox. The parent reads that isolated regular-file copy rather
than following paths that an untrusted background process could replace with
symlinks. The copier has no network access or model invocation.

The host then opens a draft PR and re-reads its actual remote branch and head.
The issue's maker receipt references the exact repair key, PR and head. The
server independently validates these references. A second standalone Codex CLI
invocation reviews the actual committed patch in a newly materialized read-only
workspace. Its structured result is parsed by the parent, which alone writes a
create-only private GitHub receipt bound to source/head, distinct invocation IDs,
reviewed engine code and actual test digests. The candidate cannot access the
parent journal or GitHub credential. This is a trusted-parent checker attestation,
not a fabricated GitHub `APPROVED` review or an App QA receipt. Findings or an
unconfirmed checker leave the PR pending.

The resulting maker status is `awaiting_checker`, never resolved or deployed.
The bridge's independent review admission, actual App QA,
approved deployment and observed production regression evidence are required by
the bridge before verified closure. This worker never merges or deploys.

After a successful source poll, the parent writes a local timestamp/count receipt.
When activated, it also maintains one metadata comment in a private worker-health
issue, at a thirty-minute cadence. This distinguishes an authenticated, connected
worker with zero jobs from a missing worker. The health comment carries the
reviewed engine revision and hash, actual poll time, source count and sign-in
booleans, never credentials or a claim that work was completed. A lost creation
acknowledgement is quarantined rather than creating duplicate health issues.
Read-only polling can continue while the daily model reservation limit is held.

## Review and activation

Before installation, run:

```sh
node --test tests/kong-repair-subscription-worker.test.mjs
node script/kong-repair-subscription-worker.mjs --readiness
node script/install-kong-repair-subscription-worker.mjs --plan
```

`--readiness` reports booleans only and does not consume or publish work. The
installer is plan-only unless explicitly invoked with the exact reviewed commit:

```sh
node script/install-kong-repair-subscription-worker.mjs --install --reviewed-sha <sha>
```

Installation requires a clean checkout on that exact commit and Node 22.23.0 at
the existing nvm path. It creates a separate runtime and one LaunchAgent with a
30-minute cadence, `RunAtLoad=false`, and no new credential. The output distinguishes
loaded from a verified first model run. Root coordination must review and approve
activation before invoking the installer. The worker has not been installed or
run against real repair work by these local tests.

To pause, `launchctl bootout` the exact installed plist. Preserve its journals,
claim refs and PRs for reconciliation; production rollback is outside this maker.
An existing installation is not silently replaced by this installer.

Official permission profile reference:
https://learn.chatgpt.com/docs/permissions

## Readiness supervision and recurring health

The startup supervisor retries only the reviewed engine's exact
`WORKER_NOT_READY` exit before it reads the queue or creates a claim. It permits
at most two retries, five seconds apart. Exit signals, output overflow, extra
output, other errors and all post-claim/model outcomes never permit a retry.
Both installed files are bound to the same reviewed commit and their hashes in
private installation metadata. Startup diagnostics record only boolean sign-in
results, exit/timeout/overflow codes and durations, never credential bodies.
The direct worker `--readiness` command remains read-only.

The LaunchAgent still polls every 30 minutes. Health publication has a minimum
20-minute interval, so a healthy poll arriving at 23:20 (the bounded scan/auth variation case) cannot suppress the next
remote heartbeat for another full cycle. An unconfirmed issue/comment write
remains quarantined; no pointer or timestamp is reset to manufacture freshness.
Maker evidence expires after 45 minutes in both server and UI, including cached
responses: the budget covers a 30-minute schedule, at most 100 seconds for three
bounded auth attempts and delays, up to five minutes for a bounded paginated
GitHub read, an engine read/publication and a five-minute cache. The actual poll
timestamp remains visible and expires; a missed later cycle does not stay green.
CEO source evidence retains its separate 30-minute limit.

For an existing installation, use a clean checkout of the exact newly reviewed
**merged** commit (never a guessed future SHA):

```
node script/install-kong-repair-subscription-worker.mjs --upgrade --reviewed-sha NEW_REVIEWED_MERGED_SHA --from-reviewed-sha EXACT_INSTALLED_SHA
```

The upgrader refuses a running worker, an existing worker lock, changed installed
hashes or unexpected LaunchAgent arguments. It privately backs up old engine,
installation metadata and LaunchAgent, unloads only this inactive service, copies
the reviewed engine/supervisor, binds the new source commit and reloads without
kickstart. Unknown journals, model reservations, pending health receipts and
GitHub claim refs are preserved. Office and KONG engine configuration must then
pin the same reviewed merged revision. No installed worker, key, environment or
production configuration is changed merely by merging this code.

Rollback requires the matching private backup and a reviewed, inactive-service
operation; restore engine, installation metadata and LaunchAgent together. Keep
all journals and health/claim evidence. Never delete a lock or reset an uncertain
claim to force another model attempt.
