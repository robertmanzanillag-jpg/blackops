# KONG CEO software repair bridge

This bridge is separate from the Asistente-only proposal factory. Its allowlist
is company `kong` and repository `robertmanzanillag-jpg/kong-nightlife`. It does
not remove the existing factory's KONG/path denials or admit paid stages.

KONG's deterministic report loop links native Product & Reliability
`manual_followup` backlog priorities to concrete persisted `error_events` report
tasks. It marks each concrete task before network delivery, saves its signed
request in the existing `ceo_handoffs` outbox, and polls the exact BlackOps repair
key. Creative callbacks, source disappearance, admin "done", retention and
ordinary report-task verification cannot close linked software repairs.

The preferred transport is the existing read-only office connection: BlackOps polls
KONG’s SELECT-only operations projection every 15 minutes with its existing
KONG_OFFICE_READ_TOKEN. The local KONG report loop persists source linkage
separately. BlackOps validates exact scope, source freshness, canonical key and
payload digest. Optional signed delivery verifies the canonical HMAC envelope. Its council namespace `kong-software-repairs-v1` stores durable
request/replay claims, handoff state, maker fences and verification receipts.
Identical delivery and fresh signed delivery of the same payload resolve the same
repair. Ambiguous GitHub issue creation remains `dispatch_unknown`; a delivery
retry never creates another issue.

A handoff is a private GitHub issue with an immutable canonical source marker,
SHA-256 digest, exact approved release branch/SHA, original task/error IDs and
occurrence generation. Issue creation is not model execution. The subscription
worker is a separately reviewed local consumer. Its GitHub-only mode uses an
atomic `codex/repair-claim/<digest>` ref at the approved SHA and a trusted parent
publisher; it needs no local HMAC secret. Existing claims and stale approved
bases are held, never replayed or automatically rebased. The signed worker RPC
is optional, separately flagged and fenced; its expired leases become unknown.

Owner status and signed KONG status polls reconcile the actual GitHub claim,
source-bound PR and current head. A source-owner-supplied PR number or SHA alone
cannot close work. Verification requires passing exact-head checks, independent
review and App QA, a merged commit observed on the actual KONG `/api/ready`
deployment, and an attributable production regression receipt. Unsupported
scenarios remain pending App QA; generic readiness does not prove an arbitrary
bug fixed.

The initial production catalog supports only `api_ready_contract`, and KONG may
select it only for a real `/api/ready` source error with HTTP status >=500. Its
standalone workflow/script must already exist in the approved source baseline;
both are compared byte-for-byte with the deployed version, actions are pinned,
and no candidate code is imported by the verifier. The successful artifact name
binds repair digest, deployed SHA and scenario. Other source routes use
`unsupported`; add a reviewed, issue-specific catalog scenario before granting
production closure. The maker may not edit the workflow or verifier script.

KONG independently rechecks GitHub proof, its own deployed SHA and the unchanged
source under database locks, then atomically records the callback replay claim,
source error closure, CEO task completion and handoff artifact. External reads
finish before locks. It requires its existing GitHub read credential for this
independent verification; absence leaves closure unconfirmed, never fabricated.

## Activation and evidence

Only after PRs, independent review and QA:

- KONG: `KONG_REPAIR_BRIDGE_ENABLED=true` and the existing report-task worker
  running. Its operations GET projects only persisted repair sources. Existing
  GitHub authorization, including the ephemeral Replit connector, independently
  verifies private repository access and closure evidence.
- BlackOps: `KONG_REPAIR_BRIDGE_ENABLED=true`,
  `KONG_REPAIR_HANDOFF_ENABLED=true`, `KONG_REPAIR_PULL_ENABLED=true`, existing
  `KONG_OFFICE_READ_TOKEN` and private KONG GitHub connector access. Both sides
  pin `KONG_REPAIR_CHECKER_ENGINE_COMMIT` to the reviewed maker engine commit.
  Preflight reads happen before reserving an issue write; failures remain
  `blocked_no_github`. An ambiguous actual issue POST remains quarantined.
- Local maker: install/enable the independently reviewed signed-in subscription
  worker after QA. Its real atomic claim, PR and parent checker receipt establish
  pickup and checking. Issue creation alone establishes neither.
- Optional HMAC delivery uses the existing configured signing capability and
  host allowlist; pull-only operation needs no new signing secret. Optional
  signed maker RPC additionally needs `KONG_REPAIR_MAKER_ENABLED=true` and
  explicit `KONG_REPAIR_WORKER_IDS`.

Owner status separates configuration, actual private GitHub preflight, durable
source-read timestamps (fresh within two polling intervals), actual maker
heartbeat (fresh within 30 minutes), checking and deployed verification. A
recent idle poll means an idle connected worker, not missing execution.
Independent checking may use the immutable receipt produced by a separate fresh
checker process outside the maker sandbox, bound to the exact source/head and
reviewed parent engine. It does not require a different GitHub account. App QA
remains a separate requirement.

After verified production evidence, BlackOps publishes a source-bound closure
receipt and closes the private issue, then confirms its actual closed state.
Lost acknowledgment leaves delivery explicitly unknown; reconciliation reads
the existing receipt before an idempotent close and never republishes an
ambiguous comment. The KONG source independently rechecks its own closure.

The actual shared-credit state is reported separately. `blocked_unknown_credit`
continues to block paid provider work; deterministic ingestion, investigation
and authorized subscription handoffs do not consume or release those credits.
The existing uncertain News execution is neither replayed nor cancelled.

Observe original source task/error IDs, repair key, durable queue acceptance,
actual maker claim, PR/head, independent checker, deployed commit and final
callback receipt. Aggregate counts, an avatar, a running process or an issue URL
alone are not this evidence chain. No merge or Replit deployment is performed by
the bridge; each deployment still requires explicit approval.

Rollback: disable bridge/handoff flags, stop the local consumer, then revert the
reviewed source changes. Preserve council/outbox/claim/receipt history; never
clear unknown work to obtain a green status. No new database table is required.
The bounded journal stops at capacity and has no automatic history pruning.

Maker heartbeat evidence has a distinct 45-minute budget for its 30-minute
scheduled worker and bounded auth/GitHub/cache delays. The worker publishes at a
20-minute minimum to avoid skipping the next healthy tick despite bounded scan/auth timing variation. Server and
UI use the same maker expiry and recalculate cached age; CEO source evidence
still expires after 30 minutes. These windows describe dated observed evidence,
not proof that every intervening attempt or model run succeeded.
