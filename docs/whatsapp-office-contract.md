# WhatsApp desk: isolated consumer integration

The current local consumer is based on
`00362379d6b8135887abf787fbfa65771a11fd25`. Its focused consumer, history and
backend-contract suite passed 70 tests; TypeScript checking and the application
build also passed. These checks use isolated fixtures, not a live WhatsApp reader,
production database or deployed office.

On 2026-11-06, `git apply --check` also passed against the separate Office owner's
working tree at `fc7f319199725c20725110f9e32a47a8215ff55e`, including its then-current
uncommitted changes. This establishes patch applicability at that moment only:
the patch was not applied there, and the combined tree was not tested or published.
Recheck applicability, preserve that owner's changes, and run the combined QA
before releasing. Do not replace the active working tree with this older base.

Historical lineage: an earlier port of reviewed consumer
`35dc14d83a71edf9d59d83b9877a0585ade904a5` from `a8fb4f6` used PR330 base
`6a3dba654fcd78288ab5aa3838438d80eb1d0028`. That is historical context, not the
current integration base. The current port preserves protocol-v2 revision/storage
guards, lossless council migration and Windows worker restrictions. It adapts the
desk to the three-ring office and separate KONG company ledger. No installer,
scheduled task, migration, rollout attestation or worker is executed by this patch.
It does not activate a bridge, read chats, run a reader, publish, replace the external
owner or establish 24/7 availability. The existing reader must supply real evidence
through the separately authorized backend transport.

## Evidence and display

The existing owner-only KONG operations collector accepts optional `whatsappReader`
v1 metadata. The strict allowlist contains scope, opaque owner, scheduler, reader,
session, observation/review/attempt/success timestamps, counts, blocker and a boolean
checkpoint-retention indicator. No chat content, group names, telephone numbers,
URLs or checkpoint values are accepted. Invalid timestamps are dropped at the
connector boundary. The source is the authenticated backend, whose explicit owner
binding remains a separate prerequisite; the office creates no producer permission.

Exactly one `kong:whatsapp_reader` desk remains visible in Sistemas KONG, even with
no transport. Only a fresh connected reading observation and recent attempt animate
the desk. A recent completed four-group read is labeled as a past result, not current
activity. Scheduler activity does not prove reading. After snapshot failure or expiry,
the card retains historical timestamps but shows unconfirmed/stale activity. Counts
in the current review and last successful reading are displayed separately.

## Life, academy and replacement

The current PR330 `advanceKongCompany` ledger grants credit only once per new
`lastSuccessAt`. Reading, polling, heartbeat, missing evidence, session problems,
permission blocks and interaction-block reports neither earn points nor drain life.
A desk without a first verified complete result has no fabricated career. Existing
careers, memories and generations remain intact during unavailable evidence.
Academy and life remain in the isolated KONG company, using its existing mechanics.
Local study or career rotation cannot replace the real external worker: that role
is unsupported by the executable-role registry, and the card states this limit.

## Account isolation

The KONG snapshot query key includes the authenticated owner. The fetch checks the
owner before requesting and again before returning a response; an account change
cannot install the previous account's response. Existing server owner guards and
council redaction remain in force. The app's existing auth remount and logout cache
clear remain unchanged.

## Local verification

Run `node --import tsx --test tests/whatsapp-pr330.test.ts tests/office-kong.test.ts
tests/kong-company.test.ts tests/kong-company-routes.test.ts tests/kong-office-wing.test.ts`.

`tests/whatsapp-backend-consumer.test.ts` additionally requires the read-only sibling
`kong-whatsapp-production-ci` at exact commit
`daada94d52df2e6b008b59799d2db723215df0c5`. It bundles the actual backend route,
validator and office-read projection and exposes them only on an ephemeral loopback
HTTP server. Auth, persistence and unrelated city/DB services use synthetic fixtures.
The projected response flows through the actual consumer parser, desk builder and
ledger for absent, blocked, unknown-session, stale, reading, completed, permission
and interaction-failure states. This is not a live database, session, reader or
deployment test. The backend checkout is never modified. Fixture owner identifiers
and the test-only read token are synthetic, with no production credential access.

Rollback: discard this isolated candidate or revert its commit; no external state
or schema was changed. BlackOps publication and activation remain outside this work.
