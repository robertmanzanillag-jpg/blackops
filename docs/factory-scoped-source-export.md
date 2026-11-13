# Scoped Asistente source export

The Asistente builder now passes its explicit trusted source paths into the
immutable GitHub exporter. Every recursive tree entry is still checked for safe
paths, SHA shape, types/modes, case collisions and parent-tree consistency before
any file body is fetched. Every selected file must exist as an ordinary regular
blob, and its decoded bytes must match the immutable tree size and Git SHA.
Unrelated bodies are never fetched or exposed to the model.

The reusable primitive accepts an explicit subset of at most 64 paths. The
installed Asistente operator now passes each job's persisted per-order selection
(`finding.sourcePaths`, at most 8 files under the allowed write roots; see
`docs/factory-asistente-operator.md`). Export makes at most 3 + N GET requests:
public repository metadata, commit, recursive tree and one blob per selected file. Selected files are capped at 100,000 bytes
each and 200,000 bytes total. Full-export pilot behavior is retained when no
subset is explicitly requested through its existing separate helper.

All Asistente GitHub requests now combine the caller's stage cancellation with
the client's existing bounded request signal. The export has a separate
90-second cumulative deadline; each GitHub request already has a 15-second
bound. Cancellation or invalid/missing/unsafe/mismatched source stops before
credit reservation or model execution. No default broader scope is inferred.

This removes the former whole-repository sequential blob download. It does not
extend the fixed 10-minute build lease or change GitHub polling, provider budget,
pricing, grant expiry, release policy, or provider retry rules. Model generation
may still consume up to 120 seconds and CI wait up to 39 fifteen-second sleeps
plus requests. Measure the actual combined duration before claiming it reliably
fits the current lease; a timeout remains an unknown outcome requiring safe
reconciliation, not resumable autonomous progress.
