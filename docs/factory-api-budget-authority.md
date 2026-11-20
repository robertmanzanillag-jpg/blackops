# Factory API monetary authority — storage contract

The Factory allowance is US$100 per UTC calendar month, not a provider deposit.
`initializeMonth` remains explicit and immutable. This change does not initialize
any month, create a checkpoint, apply SQL, provision credits, or call a provider.

This is the **storage foundation**, not completed transport coverage. Provider SDK
wrappers and legacy/integration fallback admission must be connected in the next
change before enabling this authority for paid operation. Do not create a live
checkpoint from this PR alone. The unchanged legacy Factory path remains usable
without a new checkpoint; once an authority checkpoint exists its new positive
job escrows share the monetary limit with API reservations.

## Exact amounts and historical constraints

New API reservations and verified settlements use integer microUSD (1 USD =
1,000,000 microUSD). Existing Factory fixed/spent/reserved cents remain historical
constraints at their published precision. They are multiplied by 10,000, without
claiming reconstructed sub-cent usage. A parent Factory escrow includes child API
usage; children do not create another global debit. Parent settlement must cover
verified child costs and cannot release escrow with an unsettled/unknown child.
The existing parent outcome remains at its original cents precision.

The owner GET `/api/software-factory` keeps the legacy cents projection and adds
`apiBudget`: period, limit, fixed/spent/reserved microUSD, nullable remaining,
readiness, unknown hold, reason and reconciliation evidence digest. No checkpoint
means remaining is **null**, not US$100 or the legacy remaining balance. This
projection does not imply that historical provider charges have been reconciled.

## Manual reconciliation boundary

`checkpointApiMonth(owner, checkpoint)` is an internal operator method, not a new
HTTP mutation endpoint. SQL requires the prepared schema migration to be applied
by an operator; neither startup nor a request applies it. Object storage preserves
existing version-1 ledgers and adds an optional authority section using the same
conditional write and immutable receipt mechanism. Custom external store modules
must implement the new methods before updating the store-provider contract.

A checkpoint requires an already initialized current UTC month and an immutable
SHA-256 evidence manifest, reconciliation timestamp, exact external spent/reserved
microUSD and external unknown-reservation count. The manifest must establish all
attributable historical charges and open liabilities **outside** this Factory/API
ledger, with exact original IDs/receipts and a documented cutover coverage boundary.
Do not reimport charges already represented in the Factory or API ledger. External
reserved/unknown entries remain durable across months; a new checkpoint must not
repeat those same holds and cannot clear them. Resolving such liabilities needs
a separate reviewed exact-receipt recovery, which is intentionally not supplied here. Neither
CSV aggregates, missing rows, current provider balance nor absence of a request is
proof of completeness. No automatic migration or import exists in this change.

News execution `2763c249-cd43-4ead-b6a0-111f6d76715a` remains quarantined. Its shared
hold must not be released, voided, replayed or presumed accounted by this budget.
If it is still externally unknown at reconciliation, record the external hold and
nonzero unknown count; new paid admission remains blocked. Deterministic work and
subscription work do not become paid API charges.

## Transactions and recovery

SQL API mutations use the same advisory transaction lock as Factory jobs. Object
mutations use the same generation-fenced CAS. Atomic admission combines the current
Factory budget, all prior-month open Factory/API holds, old Factory costs settled
this month, external liabilities, and API settled usage. Cross-month holds do not
expire. SQL's existing cents status/admission now also carry old Factory liabilities,
matching object storage; reconciliation records its settlement timestamp.

A stable reservation key plus request digest grants dispatch exactly once. A
previous reservation returns `admitted:false`, including after lost acknowledgment.
Ordinary settlement is idempotent only for the exact cost/evidence pair. Unknown
outcomes retain their full hold and require a separate reviewed recovery; there is
no API unknown-release helper here. Verified usage above its reservation records
an unknown overrun, preserves the reported amount/evidence and blocks new paid
admission instead of rolling back the evidence or silently freeing capacity.

Do not settle unverified usage as zero. Provider grants/token quotas remain extra
constraints and cannot increase this monthly allowance. SDK retries, streaming,
images/audio, missing pricing and fallback paths need explicit transport coverage
or a pre-dispatch hold in the integration change.

## Validation and rollback

Tests use in-memory CAS and fresh local PostgreSQL clusters over private Unix
sockets, never a production connection string. They cover concurrency, cross-month
holds, missing checkpoint, exact micro settlement/idempotency, parent escrow,
external unknown and Factory/API contention. No paid/model/network calls occur.

Roll back code before activating paid transports; preserve any existing authority
rows/objects and receipts. Never delete authority history or restore an old object
snapshot over newer financial records. An older external object adapter lacking the
new methods must fail selection rather than silently use a different budget.
