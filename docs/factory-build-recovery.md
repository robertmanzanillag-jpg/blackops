# Explicit failed-build recovery

This operator action prepares a new attempt for a settled prepublication `PATCH`
or `PROVIDER_OUTPUT_LIMIT` failure. The exact diagnostic must have a matching
settled receipt and no candidate or evidence; an output limit does not authorize
automatic retry or raise the two-repair limit. It does not replay a provider call, erase history, create another order,
unpause a worker, or publish/deploy an application. Only review-only Asistente is
supported. Unknown outcomes and failures after publication never qualify.

The prepared `buildRecoverySchemaSql` migration creates one authorization table.
Apply it explicitly inside a transaction after review; startup never creates it.
`enqueueFailedBuildRecovery` requires trusted owner/grant configuration, the exact
failed job/root/base/attempt, reserve, and local reviewed repository with target
commit. It retains the original order and outcome, records a successor and
authorization atomically, and reserves the normal monthly budget. Duplicate
operator requests return the same successor, even if subsequently unpaused.

Rebase proof requires Git ancestry and identical blobs for every file in the
job's persisted per-order selection (`request.sourcePaths`),
the factory workflow and nine protected harness files. One separately reviewed
workflow-only blob pair can be supplied explicitly; it is recorded in the proof.
No generic workflow exception exists. Changed editable source or harness blocks
recovery. The installed workflow profile must separately match the approved new
base. The original mapping and historical finding stay intact; only the new
attempt's cloned finding receives the approved base. Publisher guards remain.

The transaction uses the existing factory advisory lock, then the credit ledger's
namespace lock and row lock. Existing credit transactions do not acquire factory
locks; existing factory transactions do not acquire credit locks. A clone of the
locked ledger is validated by the existing ledger implementation; no ledger row,
grant, receipt, or provider reservation is rewritten. Admission requires an
unreconciled settled receipt matching the prior provider key and rounded billed
cost, no outstanding/unknown provider holds, no expired grant, no open factory
jobs, a paused project with release disabled, and available monthly budget.

The runtime accepts the special successor only through the installed operator
lookup, which verifies the immutable authorization, input hash and original
outcome hash. Generic queue insertion cannot manufacture that authorization.
Repair attempts advance to one and then two under the existing repair limit;
their provider keys preserve project/root and change only the attempt number.

Local unit tests cover source equivalence, workflow exception, canonical JSON
hashes, policy rejection, and pipeline attempt advancement. The dedicated public
GitHub workflow runs a new temporary PostgreSQL instance over a private Unix
socket, with no production database or provider access, to test concurrency,
duplicate recovery, forged payload rejection, ledger preservation and rollback.
Missing PostgreSQL binaries fail CI rather than skipping the transaction proof.
Local PostgreSQL testing is explicitly skipped when no binaries are configured.
