# Asistente is the factory's target

The owner clarified on 2026-11-06 that the factory is the software engineering
function of the existing Asistente agent company. The static Pages pilot is a
release/recovery proof, not a replacement product or a request to create another app.
Use existing OpenAI credits only, no payments or top-ups, and exclude Kong.

## Implemented connection, not yet activated

`POST /api/software-factory/company-orders` accepts an existing main-company order
and registered Asistente project. Authentication must establish the actual owner;
same-origin and strict input checks run before any reader or admission callback.
The route returns 503 unless a trusted credit-limited admission function is installed.
It never falls back to the generic $100 monthly enqueue function.

`companyOrderJob` creates a stable private queue reference to the order and its
content revision. It excludes closed, non-engineering, Kong-assigned and explicitly
Kong-related orders. It does not copy order text into GitHub issues or close orders.
`createCompanyOrderDiscovery` re-reads the original order, verifies its identity and
revision, resolves the exact repository head and requires trusted, zero-cost QA to
identify a real acceptance/regression scenario. The pipeline requires a permanent
test for that scenario, including when classification is an improvement.

## Isolated UI bridge: implemented, not yet proven in CI

The operator-installed UI bridge is restricted to `server/office-role-work.ts`
and `tests/office-role-work.test.ts` candidate changes. It builds both immutable
revisions in credentialless containers without network access. Only bounded,
validated static bytes leave those containers; candidate Node code never runs in
the controller and cannot mount the evidence directory.
The static export explicitly excludes AppleDouble metadata (`._` filenames),
which the fixture's dotfile-denying static server would not serve. This exclusion
is recorded in provenance. Other hidden names and traversal remain rejected.

A separate pinned Playwright container runs the baseline's trusted authentication
fixture and assertions against both static builds. It measures
`office-session-login` and `office-company-navigation` in desktop and mobile
viewports. External services and Google font CSS are synthetic adapters. This is
UI regression coverage, not proof of role-work improvements, real provider
connections, production availability or recovery. Backend acceptance retains its
separate `office-role-acceptance-v1` artifact and scope.

`office-ui-simulation-v1` contains the measured report and eight screenshots.
`createOfficeUiArtifactReader` authenticates the exact public run, workflow and
successful UI steps; checks operator-pinned workflow and aggregate harness hashes
at base/head; and verifies archive, manifests, complete coverage and PNG hashes
before returning simulation evidence. The redirect download receives no GitHub
credentials. Configure its explicit archive host allowlist from authenticated
GitHub redirect discovery, never from candidate input.

The controller must first be installed in a reviewed baseline. Then a harmless
allowed-leaf probe can exercise the bridge; that probe is infrastructure validation,
not an agent improvement. No successful real UI bridge run is claimed here.
The workflow's 25-minute ceiling must be reconciled with worker leases and check
polling before enabling autonomous orders. Unit tests are not a substitute for
this real run or the production release gate.

The latest operator handoff reports an active shared-credit ledger and successful
backend-acceptance proof; those do not activate the software-factory operator,
orders, autonomous publication or rollback. This change does not configure them.

## Historical integration observations and remaining activation requirements

The revision and deployment observations below describe the earlier integration
session. They are not current evidence that factory schema or configuration is
absent; inspect the current deployed revision and ledger before taking action.

Integration branch `codex/asistente-factory-integration` is based on office commit
`049a0510e88b75ddc5df018c489ec6dda2b327c3`. It transfers only factory files and adds
route registration, the Office panel and worker build output. It preserves current
council/company/Radio/Kong source. The other Office chat is finishing Radio recovery
and publication; coordinate its final revision before applying this integration.
Local validation: 19 focused tests, panel browser test, full TypeScript no-emit check,
and route/worker bundle compilation passed. None of these activates the executor.

- Reconcile the actual Replit source with this branch before integrating. Live
  terminal history showed a newer editor commit `580d1ef227e18dd7e7f5aa2f21b7449edeb72651`
  on `codex/office-radio-reviewed-dfe5bb1` and a publication completed during this
  work. Its upstream `codex/office-integrated-repair-20261106` was fetched at
  `5f25d29`; council/company source differs and factory modules are absent there.
  Do not overwrite the concurrent office changes with this branch.
- Bind the owner-specific council reader and a guarded admission operation to the
  SAME durable ledger, verified credit grant/expiry and executor used for work.
  This module does not establish an independent allowance or renew credits.
- Install a real Asistente builder/checker with access to its repository. The
  deployed pilot token/client and text-only builder cannot do this.
- Verify isolated Asistente QA, exact-version publication, recovery and three
  rehearsal cycles. Pilot evidence does not qualify Asistente for automatic release.
- Close company orders only after verified production evidence tied to the order,
  owner, project, commit and complete job chain. Generic automation success is not
  sufficient. This change deliberately does not add a completion adapter.

No new deployment, API charge, account credential, payment method, reload, or Kong
change is part of this integration code. It is not proof of autonomous operation.


## Shared-credit executor integration (2026-11-06)

PR 331 merged into the Office integration branch at `2213f03`; this is not a
Replit publication. The subsequent executor branch adds an explicit Asistente
repository client and a build-to-draft-PR composition. It verifies exact source,
checks immutable workflow identity and test results, and permits candidate writes
only to operator-selected leaf paths. Paths alone cannot establish isolation from
Kong: shared-module effects still require independent content/risk review. It
cannot update base branches, merge, deploy or claim that an order is completed.

Office and factory can now use ONE micro-USD ledger in a separate namespace of
the existing PostgreSQL council table. Provisioning and grant initialization are
explicit operator steps, never startup/recovery behavior. An immutable verified
grant has an expiry; neither the calendar nor a restart refills it. Unknown
provider outcomes retain their entire reservation and stop new admissions.
Every model transport rechecks the credit window and receives a bounded abort
signal. Aborting transport is not proof that provider-side execution stopped.

`OPENAI_SHARED_CREDIT_CONFIG` selects an absolute operator-owned JSON file with
`grant` and `pricing`; it contains no credential. With this setting (or
`OPENAI_SHARED_CREDITS_REQUIRED=true`), Office execution fails closed if the shared
ledger is unavailable. The loader never creates a balance. Office review and
academy calls use stable assignment/phase identities; the existing token ledger
remains a secondary limit. Verified terminal usage is accounted even if the
answer is incomplete; active/unknown provider statuses keep their holds.
The factory adapter receives the same ledger explicitly. The runtime settings
have NOT been written to the active worker.

Independent review and controlled tests cover source-to-draft-PR, prior Office
spend reducing factory credit, duplicate calls, lost commit acknowledgments,
JSONB key ordering, expiry between counting and generation, nonterminal responses
and uncertain usage. These tests use simulated transports, not live releases.

Current host observation: the existing Windows Office task is running with
five-minute recovery triggers. It depends on this PC remaining awake and online.
The worker has its existing OpenAI/database access but no GitHub credential;
Codex's interactive GitHub connector is not unattended worker access. No new
credential was installed. Exact-version Replit deployment/recovery remains an
uninstalled adapter and must be proven separately before automatic release.

Operator rollout: reconcile the other Office chat's branch, pass CI/review, bind
a narrowly scoped repository credential, verify current credit and pending usage,
provision ONE ledger, update the reviewed worker configuration, then demonstrate
real order-to-reviewed-PR execution. Keep publication disabled until Asistente's
own release/recovery rehearsals pass. Stop admissions before rollback; preserve
all ledger rows and unknown reservations. Do not reset financial state when
reverting code. No payment details, recharge, extra hosting or Kong changes are
introduced by this work.


## Authenticated adapters and order scan

The dedicated GitHub transport accepts only the Asistente repository on
api.github.com, requires cancellation, forbids redirects/retries, and supports
only candidate object/branch and draft-PR creation endpoints. It preserves the
verified Contents metadata media type. It has no workflow dispatch permission;
use push-triggered checks. Payload/branch restrictions remain enforced by the
scoped client. Its live read-only check verified repository identity, the Office
integration head and workflow contents with zero writes.

The independent reviewer now has a real immutable-source loader. It checks the
single parent, compares the entire changed-file set, verifies Git blob hashes and
fetches only changed allowed file bodies. UTF-8 bytes, including BOM, are preserved
in the text passed for review. The reviewer reserves from the same credit ledger
under a distinct stable job key; invalid billed responses cannot approve a change.
Neither component claims release eligibility.

An optional trusted company-order scan now connects to the existing worker loop.
It uses existing eligible main-company orders, excludes Kong, checks shared credit,
admits at most one pending order per scan, and uses durable order-revision keys.
Local overlapping scans coalesce; cross-process deduplication belongs to the
persistent admission operation. The balance precheck is not a reservation: the
installed admission and paid provider operations must use the same guarded store.
Pause/configuration checks run before the callback. No callback means manual
admission only, without falling back to generic daily discovery.

Operator observation: the existing Office worker is active but factory execution
and shared-credit runtime settings are absent. The selected production database
has the council and Office queue, but not the factory tables. The owner currently
has no open engineering orders. No migration, grant initialization, worker switch,
new paid request or Replit publication was performed for these adapters.

## Measured Office backend acceptance (not browser simulation)

The pinned candidate workflow now has a fixed acceptance producer for
`office-role-work-owner-cas-v1`. Only factory branches execute it. It fetches the
exact candidate and its sole parent, executes the **parent's reviewed harness**
outside both tested-code containers; each revision runs in its own network-disabled, read-only container without provider credentials,
and uploads one controller-owned `acceptance.json` artifact. Neither tested-code container mounts the output directory or host Docker socket. A bounded RPC channel exposes runtime operations and transaction callbacks, never authority to declare the assertions passed. An early successful process exit or forged pass output fails verification. The checks exercise actual role-work
modules using synthetic records and an in-memory transaction adapter: single
reservation, completion proof, restart deduplication, owner rejection, tamper
rejection, and unchanged careers. This is not a PostgreSQL concurrency test.

The Actions adapter can consume `createRoleAcceptanceArtifactReader` after its
existing immutable-workflow/run/step verification. The reader checks the GitHub
artifact SHA256, exact run/head identity, complete assertions and source revisions,
then propagates the measured scenario ID. Missing artifacts never receive an ID.
The authenticated transport allows manual 302 only for the fixed artifact ZIP GET;
the archive request carries no authorization and must use an exact operator-pinned
Azure Blob hostname. Both the download and decompression are bounded. No install,
credential, credit initialization, queue unpause, model call or deployment occurs.

GitHub documents the artifact digest and 302 download protocol at
https://docs.github.com/en/rest/actions/artifacts and the Azure Blob artifact
network family at https://docs.github.com/en/actions/reference/runners/self-hosted-runners.
Pin the exact observed storage hostname; do not accept all Azure storage.

This supplies a backend acceptance receipt, not a completed four-stage installation.
Both revisions may pass, which proves regression coverage but not improvement.
A real eligible order must name this capability and include an appropriate permanent
regression test; arbitrary orders cannot borrow this receipt. Discovery still needs
zero-cost baseline acceptance tied to the exact order revision. The simulation
stage still needs the actual relevant Office UI fixture at both revisions and
mobile/desktop evidence. Generic simulator unit tests do not satisfy that gate.
The shared credit ledger, dedicated repository credential, guarded admission and
operator module remain explicit existing prerequisites. Never fill missing browser
flags or mark the company order delivered from this backend report.

The first real candidate trial stopped before runtime because the repository tracks
`credentials/README.md` and `secrets/README.md`. Acceptance now exports each exact
commit into a new source tree, omitting only the two root credential namespaces
without reading their contents. It verifies every retained Git blob against the
commit, rejects other sensitive paths and special entries, and records the exported
manifest digest. Only these sanitized trees reach the read-only containers.
Container cleanup tolerates an auto-removal race only when a separate exact-name
Docker query proves that no container remains; daemon errors remain failures.
