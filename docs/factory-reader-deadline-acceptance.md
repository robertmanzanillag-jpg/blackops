# Trusted reader deadline regression

`office-role-work-reader-deadline-v1` is distinct from the existing owner/CAS
acceptance scenario. It does not change `server/office-role-work.ts` or its tests.
The factory candidate remains restricted to those two approved files.

The controller concurrently gives the SQL/legal and web/news readers unresolved
Promises. It measures real elapsed time against the existing default 60-second
lease; no shortened candidate option or fake clock is passed. A 68-second
watchdog bounds each case. A qualifying candidate leaves the first assignment
unknown without proof, completes the subsequent control role, ignores a late
successful response, preserves careers and does not repeat either read through
a fresh runner instance. The baseline trusted parser validates all persisted
proofs; the candidate parser must return exactly that controller-owned journal.

The old owner/CAS safety checks must pass for both revisions. New regression
credit is emitted only when both baseline deadline cases actually time out and
both candidate deadline cases pass all assertions within the measured bounds.
A missing deadline report, an already-passing baseline, a fabricated early pass,
or a safety failure never supplies this new scenario ID. Baseline regression
failure is expected evidence, not a claim that baseline safety failed. The
workflow may collect both failed deadline reports during trusted-harness
bootstrap; it does not qualify such a run as a deadline fix.

Both revision containers are independently bounded to 90 seconds. The host
controller is bounded to 300 seconds, including export and cleanup. Pending
read promises are released during cleanup; underlying production I/O is not
claimed cancelled by this harness. SQL/web scope and model pricing are unchanged.

Operator mapping may explicitly choose this new scenario only after the reviewed
harness is in the pinned base revision and the artifact verifier is installed.
Workflow/harness digests must be refreshed from the final reviewed code, because
the trusted RPC bridge and harness file set changed. No order creation, schema,
private configuration, grant initialization, unpause or provider call occurs here.

Local negative reproduction against the unchanged runner observed SQL and web
watchdogs at roughly 68 seconds, no following role before reader release, and
unchanged careers. A passing real candidate has not yet been generated or tested.
