# Attributed editorial preparation

This adapter prepares reviewable text from the existing web host's saved public news events. It does not research new facts, translate, approve, modify the publishing queue, deliver messages or publish. `news` produces the desk package; `news:ny-news` and `news:miami-news` produce their respective attributed drafts. The same event/revision has the same draft ID in both desk and city views, not a second business action.

## Canonical source and ownership

The web exporter calls `readWebEditorialSource` with the configured owner and `CLIPPERS_LOCAL_NEWS_WORKSPACE` (default `clippers_workspace/local-news`). It reads only the existing `state.json`: no bootstrap, fallback/demo data or filesystem writes. The owner must match configuration and exist in `users`. Missing, malformed and oversized files remain distinct unsuccessful source states. The read is capped at 1 MiB, at most 200 queue entries are projected, and incomplete coverage blocks preparation rather than silently claiming all stories were handled.

The projection verifies the current event revision and canonical-event hash, plus the stored queue-review hash and three unanimous approval records. These are the originating committee's records, not independent verification. Only active, low-risk events with verified provenance and public allowlisted HTTPS source URLs pass. Query strings, credentials, nonpublic domains, sensitive-content flags and missing evidence block an item. Queue copy and instructions are used only to verify the originating hashes; neither is exported as an editorial fact. Free-form review reasons and evidence are not exported.

The retained title, description and location are quoted exactly and cited by field. A resulting body adds only attribution, source URL, recorded fetch time and revision. No assertion is made that the source was fetched again. Original cadence and approval gates remain in the package. Empty or stale evidence produces no successful draft.

## Persistence and runner contract

`persistEditorialSource` and `readStoredEditorialSource` use owner-bound namespace `office_editorial_source_v1` in existing `revenue_engine_state`. A newer export replaces the snapshot; an identical export is idempotent; stale or same-time conflicting exports fail. No schema creation occurs. The worker never reads a local news workspace.

`createEditorialWorkRunner` uses separate namespace `office_editorial_work_v1`. It reserves one job per role/generation/UTC day, under the council's owner advisory lock. Callers supply `getGeneration` via read-only council load and `eligibleBusinessGeneration` to exclude exhausted or unapproved careers. The source read is outside the lock, with a 60-second deadline; completion rechecks the generation, lease and fence. A running job blocks other admissions; an uncertain job blocks its own role and is never automatically retried. Stop prevents new work; an already admitted read-only preparation drains. There are no provider calls or publication callbacks.

Exports must have been observed within five minutes, their original source cycle within two hours, and event provenance fetched within 24 hours. Expired or not-yet-effective events are withheld. These conservative limits do not imply complete coverage or live news verification.

History retains sanitized source, full draft/citations and canonical proof. Reload recomputes the artifact at its original completion time, including JSONB key reordering. `readEditorialWork` is a read-only GET adapter; `editorialWorkCapacity` exposes the same 200-job / 4 MB admission limits as the worker. History is never automatically pruned. Capacity exhaustion requires explicit archival design before more work is admitted.

## Integration and validation

No worker, exporter scheduler, route or UI is activated by these modules alone. Integration must wire the existing authorized internal-work flag, configured owner and shared PostgreSQL connection; expose artifacts only through the authenticated owner route with `Cache-Control: no-store`; and preserve existing budgets and role lifecycle. These narrow editorial-preparation receipts do not qualify an entire news agent for promotion or prove publication.

Focused tests cover actual source-schema/hash fixtures, citation fidelity, revision mismatches, platform deduplication, sensitive/private-source rejection, filesystem absence/corruption/size limits, owner isolation, read-only GET, idempotent persistence, concurrent reservation, restart, JSONB tampering, expiry and stale generation.


## Supervised recovery after a corrected source

`recoverEditorialPreparation` is an operator-only API, not called by the worker, a route or a timer. It appends one new attempt for an exact same-day ordinary terminal-blocked parent. Required fences are the parent ID/proof, unchanged generation, different expected source digest and operator audit ID. The parent, its original source and its original artifact remain byte-equivalent in canonical JSON. Ordinary role/day/generation uniqueness is unchanged, and recovery chains or a second attempt for the same parent are forbidden.

Before application, the operator must verify the corrected canonical export actually produces nonempty drafts. The function still reads and verifies the source, applies current generation eligibility, the shared owner lock, global running-work guard, 60-second lease, history limits and exact artifact recomputation. A changed/empty source creates a separately blocked attempt; an expired or changed holder creates an unknown attempt. Neither is automatically retried. Only a fresh nonempty validated delivery can complete. All preparation remains read-only toward business queues and external services.

Deploy the compatible parser to every reader/writer and drain older instances **before** creating recovery records: older strict job schemas reject the added metadata. Pause the ordinary worker and protect a full-state backup. Do not hold an outer owner advisory lock while invoking this function, because it obtains that lock itself; its expected proofs and generation checks fence the reservation. The `getGeneration` callback must use an independent read connection or pool, as the ordinary runner does, and never mutate council state. Verify the saved new job and untouched parent after completion, then resume only the reviewed compatible worker. Do not delete old jobs, change their dates/generations or rewrite a blocked result as a success.
