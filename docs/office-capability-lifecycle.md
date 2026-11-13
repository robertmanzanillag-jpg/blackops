# Saved-audit triage lifecycle

This lifecycle applies only to `source-triage-v1` for the fourteen existing role
identifiers. It does not grant publication, sales, payments, legal decisions,
trading, media processing, repository writes or full-role replacement. The
deterministic source-audit reader keeps its existing behavior. No second factory
or scheduler is created.

The trainer's existing owner-isolated durable council transaction is the admission
and completion boundary. Runs retain source job, generation, policy, prompt
version, fence, actual response, independently verified cost and canonical proof.
The lifecycle is replayed from that complete journal; no model-authored score is
accepted. The same fixed evaluator used by training classifies attributable
output failures. V1 instruction ambiguity, missing/stale/incomplete sources,
unknown provider/cost results and legitimate empty sources are exempt. Holdout
grades never subtract life.

The capability-policy battery follows the existing company defaults: 80 initial,
10 lost per attributable failed production result, 6 gained per successful result,
100 maximum, and at least 24 hours' tenure before retirement. Whole-agent battery,
career generation and history remain unchanged. Retirement is permanent for that
policy, survives restart and prevents a fresh baseline from silently replacing it.

A retired policy's candidate may finish the existing three separate-day paired
evaluations under the unchanged daily/token/cost limits. Strict improvement in at
least two comparisons, successful answers throughout, and no cost/time regression
remain required. A 100/100 baseline does not manufacture an improvement. Without
an eligible candidate, capability production stays vacant. A qualified policy
enters probation and consumes the next unconsumed saved audit with its original
source provenance. Its first real completion is recorded; failed probation cannot
restore a retired parent. Already completed or unknown attempts are never replayed.
If the available candidate is rejected and the parent is retired, the capability
reports `blocked_no_qualified_successor`. It requires new verified feedback or a
reviewed curriculum revision; this change does not generate clones or pretend
that preparation continues indefinitely.

Queue transfer means only selection of the existing unconsumed saved-audit jobs
for the same role and career generation. It is not a transfer of business orders.
The diagnostic projection can include exact pending source job IDs when the
validated role-work journal is supplied. The API policy summary has no queue
snapshot and explicitly reports that queue evidence is unavailable.
Current production eligibility also requires the council's current generation;
without that snapshot the diagnostic reports only local policy eligibility.
The private office panel shows capability life even for baseline policies with
zero lessons, with an explicit distinction from whole-agent life.

## Retention and activation limits

The existing journal is append-only and stops admission at 200 runs or 100
policies. This change does **not** prune it, implement a rolling window, or reset
retirement. A future compaction must carry a validated cumulative checkpoint and
all referenced policy/receipt history before removing any run. Manual deletion of
unreferenced history is not supported; hashes prove receipt integrity, not that an
operator has never removed a row. Capacity exhaustion is a real remaining limit.

The code becomes effective only when the reviewed trainer revision is deployed
and the existing configured worker is restarted by the operator. No flag, budget,
credential, worker launcher or production state is changed by this PR. Rollback
must pause training first: an older trainer would not enforce capability retirement.
No new persisted schema is introduced; old proofs and policy objects stay intact.

Tests cover verified failure through retirement, no candidate availability,
strict qualification, queue transfer and first execution, failed probation,
concurrent runner admission, JSONB/restart replay, unknown/source exemptions,
duplicate evidence, journal capacity and retained history. Existing trainer tests
cover all fourteen-role fairness, old prompt isolation, owner/generation fences,
equal-quality rejection and unchanged budgets. Real provider invocations and
production activation are intentionally outside this test run.
