# Mandatory API transport gate

Depends on the Factory monetary storage/checkpoint contract in
`factory-api-budget-authority.md`. This change adds no funds, API keys, model
selection, live price quotes, configuration changes, migration or activation.
Subscription CLI work, deterministic work and local models are unchanged.

## Covered boundaries

- OpenAI singleton, routed own OpenAI/DeepSeek clients, custom router clients,
  router-disabled legacy and Replit OpenAI integration clients all pass the same
  monetary invocation boundary. The router's existing 200/50 provider limits are
  secondary constraints and never add allowance to Factory100.
- Clippers local-news OpenAI translation (including its legacy path) uses that
  boundary. Local OpusMT translation remains local.
- Office reviews, optional chat, Academy and capability training all use the
  guarded Responses fetch. Shared-grant/token authorization remains secondary;
  a read-only monetary preflight denies exhausted/unreconciled work before those
  secondary reservations are created. A final atomic reserve/window check still
  happens before the provider operation; preflight is not an execution permit.
- Factory's authenticated raw transport requires a live parent scope installed
  by the worker from the actual claimed row and cancellation signal. The owner hash, job, fence, lease
  and remaining protected escrow are checked in storage. No task/model payload
  can install that context. API child usage is included in the existing parent
  escrow, not charged again globally. Alternative Responses composition guards
  injected transports; the pilot export rejects an unauthoritative raw provider.
- Gemini's SDK is held before every operation, including model generation,
  streaming and other nested SDK methods. Its installed adapter has no verified
  complete maximum/settlement policy for thought/tool/modality dimensions.
  [Google's usage metadata](https://ai.google.dev/api/generate-content#UsageMetadata)
  documents separate dimensions; treating missing ones as zero would not prove
  a charge. This is an explicit hold, not a free fallback or a new model choice.

## Supported and held operations

Bounded text Chat Completions/Responses can run only with initialized monthly
Factory state, a complete manual historical checkpoint and approved exact pricing.
No such live checkpoint or pricing configuration is created by this change.
Streaming, audio, images, hosted tools, remote media/conversation state, priority
service tiers, unbounded outputs and raw token-counting endpoints stay held before
SDK/HTTP dispatch. Consequently the existing two-request Factory count/generate
adapter remains held at its count operation; a separately reviewed bound/receipt
adapter is required to enable it. The signed-subscription maker remains available.

The nonsecret `FACTORY_API_PRICING_CONFIG` is a strict version-1 object with an
array `prices`. Each row binds an exact `provider` (`openai`, `deepseek`, `gemini`
or `integration`), model, positive integer input/output nanodollars per token,
optional verified nonnegative cached-input rate, `validUntil` and an evidence
manifest SHA-256. Duplicate provider/model rows, missing/expired prices or cached
usage without an approved cache rate are held. No default price is supplied and
there is no fallback to the old router's estimated price catalog. A cached rate
higher than the uncached rate is rejected before admission. Operator evidence
must establish the actual applicable price/tier and upper bound; configuration
alone is not a claim this has been reviewed or provider billing reconciled.

Office can reuse its existing operator-verified price/expiry evidence for uncached
Responses. Positive cached usage still needs an approved cached rate; otherwise
it stays unknown. No absence of cache/usage metadata is converted into zero. Request bodies and
allowed options are privately snapshotted before the first await; the same frozen
JSON values are validated, hashed and sent. Only signal/timeout request options
are accepted, so SDK body/query/path/method/header/stream overrides cannot change
the priced request. Reusable remote prompts/context and ambiguous simultaneous
max-token fields are held. Credential/provider/base-URL selection uses the same
normalized configuration source, including placeholder integration values.
OpenAI cache usage comes from direct prompt/input token details, DeepSeek cache
usage from its [direct cache-hit count](https://api-docs.deepseek.com/guides/kv_cache/). The returned exact model, response ID and
measured token counters are hashed with the request/pricing evidence in settlement.
Costs use integer arithmetic and microUSD rounding, not a reconstructed invoice.
The original parent cents ledger remains at its published historical precision.

## Dispatch and uncertainty

Reservations have stable assignment keys when the caller supplies an execution ID.
A prior durable reservation never grants another dispatch. Immediately before the
single SDK/HTTP operation, a storage window rechecks current month/checkpoint,
unknown liabilities, total exposure, live parent identity and a maximum two-minute
reservation lifetime. The provider receives retries=0 and a bounded signal/timeout;
price/window expiry before confirmed completion retains an unknown hold.

A provider exception, missing usage, wrong model or settlement acknowledgment loss
never means zero usage. Full escrow remains and new paid work is fenced. Reported
usage above its reserve persists as an unknown overrun. Unknown cannot be released
through these adapters. The router never tries another paid provider after any
Factory monetary error. A typed pre-dispatch refusal can set its secondary router
reservation to zero only because this trusted boundary positively knows no SDK
operation occurred; an HTTP400 alone does not establish that proof.

Before deployment, update the operator-selected object store module with the
same store methods (including `executionWindowApi`). A missing method/storage,
pricing or historical proof fails closed. Do not initialize a month or create a
checkpoint from current Factory remaining cents. News unknown holds remain
quarantined and must be represented in the manual external-liability evidence.

## Validation and remaining operation

Tests use injected fake SDK/HTTP transports and a synthetic monetary store;
existing storage tests use disposable PostgreSQL/CAS. No production configuration,
provider request, historical reconciliation or paid execution has been performed.
Owner GET reports monetary readiness separately from legacy Factory metadata.
Actual operation requires reviewed deployment, complete attribution/checkpoint,
verified applicable pricing and all existing workload/grant permission gates.
Do not label the real pipeline verified from these fixtures. Rollback must retain
all monetary/secondary receipts and stop paid operation before removing a guard.
