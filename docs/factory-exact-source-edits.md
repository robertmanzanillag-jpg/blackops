# Exact original-source edits for Asistente

Asistente explicitly requests `exactSourceEdits` instead of model-authored diff
hunks. Legacy raw-diff generation and the independent pilot's `plainTextEdits`
mode are unchanged. The first live failure retained its known usage receipt;
its raw patch was not saved, so no particular formatting mistake is asserted.

The model returns only `{"edits":[{"path":"...","before":"...","after":"..."}]}`.
Paths must match the operator's exact source allowlist. Each nonempty `before`
string must occur exactly once in the ORIGINAL immutable file. All offsets are
resolved before any edit is applied; overlapping ranges are rejected. Adjacent
ranges are allowed. Replacements are applied in reverse offset order, and files
are emitted in deterministic path order. The trusted converter computes complete
file diff hunks and line counts; the model never controls their syntax.

There are at most 16 edits, at most 65,536 response bytes, and at most 65,536
combined UTF-8 bytes of before/after text. Unknown keys, foreign paths, CR, NUL,
BOM, unpaired surrogates and control characters are rejected. LF is the permitted
multiline delimiter; tabs are unsupported. Unsupported source forms are rejected
before the provider request. Files must retain their terminal LF and cannot be
emptied through this mode. Resulting patches are capped at 524,288 bytes.

Known billed malformed edits return an empty patch, the unchanged known cost and
an allowlisted diagnostic such as `NONUNIQUE_EDIT`, `OVERLAPPING_EDITS` or
`EDIT_PATH_NOT_ALLOWED`. Raw model text is not included in diagnostic messages.
Ambiguous provider results still retain their credit reservation. The strict
publisher, immutable baseline checks, isolated CI, regression oracle and separate
reviewer remain required. This is a representation change, not permission to
publish, retry a settled job, relax budget or bypass tests.

Synthetic tests verify multi-file replacement, matching against original rather
than already-edited text, deterministic hunks, rejection cases, accounting and
publication ordering. No new live provider attempt or production change was
performed while implementing this module.

Before export or model admission, the Asistente adapter resolves the configured
base branch through the validated GitHub client (exact ref and commit type) and
requires its current SHA to equal the finding. A stale finding blocks without
provider calls. Immutable 9895bb1 fixtures verify the two actual allowed files
remain supported, and a local Git apply proves generated multi-file changes
produce exactly the intended bytes. This does not prevent a later branch race;
the publisher still rechecks immediately before publication.

## Bounded build output

The operator may configure up to 8,192 build output tokens. Independent review
remains capped at 4,096 and retains its prior reasoning configuration. Only the
Asistente builder using the explicitly supported `gpt-6-astra` model requests
`reasoning.effort: low`; both exact token counting and generation receive that
same setting, and its value is included in the shared-credit request fingerprint.
Legacy callers omit the optional setting. Provider and credit execution deadlines
are unchanged.

At the explicitly configured upper-bound rates of 12,500 input and 50,000 output
nanodollars/token, 32,000 input plus 8,192 output tokens rounds upward to 81 cents.
This fits a 100-cent reservation; the provider still checks the exact counted
input before generation. No grant, reservation, repair limit, pricing expiration
or automatic retry is changed by this configuration allowance. Actual model
quality must still pass the existing independent acceptance and review gates.
