# Durable marketing preparation history

Marketing previously stored `learning-runs.json` on the web host. Publication can
replace that filesystem; observed historical counts and screenshots do not recover
the original recommendation text. This repair never reconstructs those lost rows.

Production GET and POST use the existing `revenue_engine_state` table, namespace
`marketing_command_center_learning_v1`, with authenticated `owner_user_id` and an
owner digest inside the validated JSON envelope. The table must already exist;
there is no automatic schema creation. GET checks the owner and reads only. It
does not initialize a collection or access marketing/dropshipping files.

POST uses an owner/namespace advisory transaction lock, validates existing data,
and commits before reporting completion. Default idempotency is UTC date plus
focus client, scoped to the owner. An optional `Idempotency-Key` also incorporates
the focus client. Retrying a lost commit acknowledgement reads the same saved
run; a failed write never becomes a cached success. All records are retained up
to the explicit 200-run/1 MB bound; exhaustion fails rather than deleting history.

The saved operation is **preparation from internal client templates**. It is not
measured learning, campaign execution, verified connections, revenue, spending or
publication. Production projections report `needs_data`, planned workstreams and
unverified metrics. The UI says preparation and hides unverified financial values.
Legacy synchronous local functions remain for development/tests; direct global
access fails closed in production. Request APIs use explicit owner context and
owner-specific local files only when production PostgreSQL mode is not selected.

The canonical web exporter reads the same owner-bound PostgreSQL namespace. It
keeps original record dates, exports only counts/hashes, and treats absent,
corrupt or unavailable history distinctly. It never falls back to an old file in
production. A bad marketing timestamp blocks that source, not the other six roles.

## Historical preservation and release verification

`store.importHistory(owner, completeRecords)` is an operator-only code interface;
it is not an HTTP endpoint or automatic migration. It accepts only complete
validated records, deduplicates identical IDs and rejects conflicting contents.
Import requires independently establishing the original file's owner. Counts,
screenshots and observation times remain historical evidence, not substitute rows.

Before release, verify the existing table columns/primary key without DDL. After
review, the operator can prepare one real internal plan through this exact service,
retain its ID/body digest privately, then verify it with a fresh pool after web
publication and through the authenticated UI. Clicking preparation again on the
same UTC date/focus must replay that ID without another row. No provider call,
external message, campaign or spending is part of this verification.

Rollback to an older web revision would resume ephemeral/global history access;
disable the marketing preparation endpoint before such a rollback. Preserve the
PostgreSQL namespace and original records. No factory runtime, office worker,
credentials or budgets are changed here.

Tests cover owner isolation, JSONB/restart, parallel POST idempotency, focus/day
separation, unknown client, malformed history, rollback, ambiguous commit ACK,
explicit import conflicts, GET without filesystem effects, no-store HTTP errors,
fresh-session/response-owner UI gates and sanitized canonical export provenance.
SQL tests use an injected transactional fixture; actual publication/pool verification
is a separate operator gate and is not claimed by unit tests.
