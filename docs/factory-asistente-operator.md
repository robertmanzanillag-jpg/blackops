# Asistente proposal operator installation contract

This module connects existing owner-approved orders to discovery, a bounded model
patch, immutable GitHub checks, measured browser simulation and a separate model
review. It stops at a reviewed draft PR. It cannot deploy, merge, close company
orders, initialize credit grants, create schema, unpause or enable learning.

The trusted launcher must supply `DATABASE_URL`, `DEFAULT_USER_ID`,
`SOFTWARE_FACTORY_OWNER_ID` (the same owner), `AGENT_COUNCIL_STORAGE=postgres`,
`OPENAI_SHARED_CREDIT_CONFIG`, `SOFTWARE_FACTORY_OPERATOR_CONFIG`,
`OPENAI_API_KEY` and `SOFTWARE_FACTORY_GITHUB_TOKEN`. Read credentials only from
the existing private files after validating their access permissions. Clear
inherited provider/database variables and prohibit repository `.env` loading.
Never copy these credentials into the operator JSON, source tree, model context,
command arguments or logs. The launcher sets `SOFTWARE_FACTORY_ADAPTER_MODULE`
to the installed reviewed `server/software-factory-asistente-operator.ts` module.

The operator JSON is strict and noncredential. Required fields are the owner,
`projectId: "asistente"`, approved base branch, checks profile, archive host
allowlist, four stage reservations in cents, model input/output limits, explicit
order mappings and the UI workflow/harness digest profile. Output is capped at
4096 tokens for the independent review call. Each order mapping binds its exact
ID, revision digest, exact current base commit, reviewed finding kind, a fixed
known acceptance scenario and an explicit per-order `paths` list. At most five
orders may be mapped at once. Completed mappings must be explicitly removed by
the operator before adding later orders; this does not delete their financial or
queue records. Empty
mappings mean no automatically selected orders. Arbitrary orders do not acquire
an acceptance scenario from model output or keyword matching.

The existing registered project must be `asistente` in the exact Asistente
repository, with all release flags false and exactly the two measured browser
journeys `office-session-login` and `office-company-navigation`. Workflow and
harness hashes must come from the final independently reviewed revision, with
real successful workflow evidence and the observed allowed artifact hosts.
Do not guess these values or fabricate a passing report.

## Allowed folders, per-order files and daily draft PR cap

The repository is fixed to `robertmanzanillag-jpg/blackops`. The former
fixed `sourcePaths` field (exactly `server/office-role-work.ts` and
`tests/office-role-work.test.ts`) has been removed; the strict schema now rejects
it. Migrate by deleting `sourcePaths` and adding `paths` to every order mapping
(the previous behavior is `paths: ["server/office-role-work.ts",
"tests/office-role-work.test.ts"]`).

| Field | Default | Bounds | Meaning |
| --- | --- | --- | --- |
| `writeRoots` | `["server/", "client/", "shared/", "tests/"]` | 1-16 entries | Folder prefixes (ending in `/`) the factory may edit. Each must be one of the four defaults or a subfolder of them. Configuration can only narrow scope. |
| `maxFilesPerOrder` | `6` | 1-8 | Upper bound on each order's `paths`. |
| `maxDraftPullRequestsPerDay` | `5` | 1-10 | Owner-wide draft PRs per UTC day. |
| `orders[].paths` | required | 1..`maxFilesPerOrder` | Exact existing files the order may read and edit. At least one must be a test file because every candidate needs a permanent regression test. |

Code-owned denials (`server/software-factory-write-scope.ts`) apply regardless of
configuration and are re-checked at configuration, at discovery/build/review for
the persisted selection, in the scoped exporter and at the GitHub `createTree`
write boundary. Denied: any segment named `.github`, `.claude`, `.agents`,
`credentials`, `secrets`, `migrations`, `drizzle`, `node_modules`, `dist` or
`.git`; `.env*`; `*.pem`, `*.key`, `*.p12`, `*.pfx`; `package.json`,
`package-lock.json`, `pnpm-lock.yaml`, `.replit`, `replit.nix`,
`drizzle.config.ts`, `AGENTS.md`, `CLAUDE.md` at any depth; `script/replit-*`;
any path containing `..`, absolute or drive paths, backslashes, empty or `.`
segments, control characters or non-NFC text; and the pre-existing sensitive-name
guard (`kong`, `software-factory`, `office-token-budget`, `credit`, `auth`,
`permission`, `payment`, `migration`). The writer accepts only blob entries with
modes `100644`/`100755`, so symlinks, submodules and trees cannot be written; the
exporter already requires every selected file to be an ordinary regular blob.

For mapped orders, file selection is explicit and deterministic: there is no paid selection stage (automatic orders use the bounded selection described below).
Discovery copies the mapping's `paths` into the job's persisted
`finding.sourcePaths`. Build, repair attempts, the independent review loader and
build recovery reuse that persisted list verbatim and never re-select, while
still re-validating it against the current roots and denials (a narrowed
configuration blocks an in-flight job at zero cost). Jobs persisted before this
change have no `finding.sourcePaths`; their builds block at zero cost with
`FACTORY_ASISTENTE_PATHS_INVALID` and must be re-admitted under a new mapping.
Build recovery now takes `request.sourcePaths`, which must equal the failed job's
persisted selection; its rebase proof covers those files plus the factory
workflow and the fixed harness files.

The daily cap counts, from the factory store, build jobs created or completed in
the current UTC day whose persisted state holds a draft PR URL, plus any build
left `unknown` or later reconciled (conservatively assumed published). If the
bounded 100-row listing cannot prove the whole day is covered, the count fails
closed. When the cap is reached the scheduler admits no further orders (no
credit hold, no queue write), and a build that reaches its stage returns a
zero-cost deferral before export, model credit reservation or publication. The
worker requeues that job (`store.defer`) until the next UTC midnight with its
factory budget reservation retained; it is not marked failed or unknown. A
deferral that would cross into another month, or a store without `defer`,
degrades to a terminal zero-cost block. A count failure defers for one hour.

Example (synthetic values only, no credentials):

```json
{
  "owner": "<owner-id>",
  "projectId": "asistente",
  "baseBranch": "main",
  "writeRoots": ["server/", "client/src/", "shared/", "tests/"],
  "maxFilesPerOrder": 6,
  "maxDraftPullRequestsPerDay": 5,
  "checks": { "trigger": "push", "workflowId": 123, "workflowPath": ".github/workflows/factory-candidate-checks.yml", "workflowSha256": "<64 hex>", "jobName": "isolated", "testStep": "tests", "buildStep": "build", "browserStep": "browser" },
  "archiveHosts": ["<account>.blob.core.windows.net"],
  "reservations": { "discover": 1, "build": 100, "simulate": 1, "review": 50 },
  "maxInputTokens": 32000,
  "maxOutputTokens": 8192,
  "orders": [
    { "id": "<order-id>", "revision": "<64 hex>", "baseSha": "<40 hex>", "kind": "improvement", "scenarioId": "office-role-work-owner-cas-v1",
      "paths": ["server/office-role-work.ts", "tests/office-role-work.test.ts"] }
  ],
  "ui": { "workflowId": 123, "workflowSha256": "<64 hex>", "harnessSha256": "<64 hex>" }
}
```

## Automatic owner orders (`autoAdmit`)

Optional and disabled by default (absent or `enabled: false`). When enabled,
orders created by the authenticated owner through `POST /api/agent-company/orders`
flow into the factory without a hand-written mapping, still ending only in a
reviewed draft PR.

| Field | Default | Bounds | Meaning |
| --- | --- | --- | --- |
| `autoAdmit.enabled` | absent (off) | boolean | Turns automatic admission on. |
| `autoAdmit.since` | required | ISO datetime | Only orders with `createdAt >= since` are admitted. |
| `autoAdmit.maxPerDay` | `maxDraftPullRequestsPerDay` | 1..`maxDraftPullRequestsPerDay` | Automatic admissions per UTC day. |
| `autoAdmit.systemOrders` | absent (false) | boolean | Also admit office self-heal system orders whose text equals the fixed template (see `docs/office-role-evidence.md`). |

Admission. Explicit `orders[]` mappings keep working unchanged and take
precedence: a mapped id (any revision) is never admitted automatically. Eligible
orders follow the existing `companyOrderJob` rules (open, at most 500 characters,
no Kong assignee or Kong text, a pending engineering assignee); Kong orders are
never admitted. The scheduler admits mapped orders first (newest first, as
before), then automatic ones oldest first, at most one new admission per scan.
The durable admission key is still the order revision. Before any credit hold,
both the draft PR cap and `maxPerDay` are checked (scheduler and owner route);
capped means no hold and no queue write. Settled admissions that left the
bounded 100-row job window are treated as history and never re-admitted.

Discovery. The base is the current head of `baseBranch` (no pinned SHA). The
operator lists the tree at that exact commit through the scoped read-only GitHub
client: paths only, ordinary `100644` blobs allowed by the code-owned write scope
and `writeRoots`, at most 4000 (more fails closed). One bounded model call,
reserved in the shared credit ledger under a stable key per order revision
(`factory-select:*`), with at most 1024 output tokens and a strict JSON schema,
returns `{kind: "bug"|"improvement", paths: [...]}`. Code validates it with
`validateFactoryOrderPaths`, membership in the listing, at most
`maxFilesPerOrder` files and at least one test file. Anything invalid (malformed
JSON, extra keys, denied, missing or too many paths, no test file, provider not
completed) is a terminal `blocked` discovery with the known billed cost and no
further cost. Unavailable credit blocks before any provider call at zero cost. An
unknown provider outcome leaves the hold `unknown` (factory pauses for operator
reconciliation); an existing selection reservation is never replayed (a settled
one blocks with `FACTORY_AUTO_SELECTION_ALREADY_EXECUTED`). The selection and
kind are persisted into `finding.sourcePaths`/`finding.kind`, so build, repair,
review, recovery and replay reuse them exactly like explicit paths. The selection
cost is charged against `reservations.discover`; size it for the repository
listing (roughly one input token per four characters of paths) or the provider
budget check blocks the selection at zero cost and consumes that revision's key
(edit the order to obtain a new revision).

Acceptance. Automatic orders use the code-owned scenario
`company-order-checks-v1`: it is satisfied only when the pinned isolated
workflow's test, build and browser steps succeed on the exact candidate head, and
the candidate changes at least one test file. It does not require the
`office-role-work` backend artifact. Mapped orders keep their role-work scenarios
and artifact reader unchanged. The proposal gate still requires passing checks,
measured simulation and an independent review on the exact head, and the PR is
always a draft; nothing merges or deploys.

Order text is requirements only. It cannot widen paths, select the scenario,
change kind outside the enum, budgets, credentials, permissions or reach Kong;
those are enforced in code.

Example additions (synthetic values only):

```json
{
  "maxDraftPullRequestsPerDay": 5,
  "reservations": { "discover": 10, "build": 100, "simulate": 1, "review": 50 },
  "orders": [],
  "autoAdmit": { "enabled": true, "since": "2026-11-12T00:00:00Z", "maxPerDay": 3 }
}
```

Run exported `preflightFactoryOperator({store})` with the same configured store
before installation. This reads configuration, existing credit state and project
registration; it performs no admission or provider call. A paused factory remains
paused. Operator startup requires enough currently available credits for one
configured build and review, valid pricing, and no unresolved credit outcome.

Admission places a stable no-provider hold covering the configured build and
review ceilings while it enqueues the exact order revision. After a confirmed
queue receipt, it settles that admission hold at zero using explicit no-provider
evidence. Actual model stages reserve separately before every paid execution;
this admission hold is not whole-job funding and there is no cross-ledger atomic
transaction. An ambiguous enqueue acknowledgement leaves its hold untouched and
marks the admission unknown, blocking new shared-credit admissions until operator
reconciliation. A settled
admission returns only its existing exact queue job; if the bounded 100-row recent-job
lookup no longer contains it (including after other work consumed that window), it fails closed instead of recreating work.

The independent UI artifact reader is a direct reviewed import, not an optional
placeholder. Integration of its code and real CI proof is required before this
module can be installed. Tests use synthetic transports and make no paid calls.
No installation or activation is performed by adding these files.


Artifact transport policy: `allowGitHubResultsAzureHosts` defaults to false. Exact
operator archive pins remain valid. When explicitly enabled, both readers also
accept `productionresultssa` + decimal shard + `.blob.core.windows.net`, only on
a fresh redirect from the authenticated artifact endpoint after identity checks.
GitHub documents `*.blob.core.windows.net` for artifact transport at
https://docs.github.com/en/actions/reference/runners/self-hosted-runners . The
narrower production-result prefix is an inference from observed shards sa6, sa7,
and sa12, not a GitHub guarantee. Other Azure accounts, explicit ports (including
443), userinfo, HTTP and fragments are rejected. Downloads carry no credentials
or cookies, follow no redirects, and retain archive/digest/evidence validation.
This opt-in does not enable general network access or change the shared budget.


## Idle process presence

The long-lived Windows loop keeps a 15-second database maintenance heartbeat while idle. Its claim/admission poll remains hourly. Presence means the process can reach its existing ledger; it does not mean a job is running, a proposal succeeded, or publication is enabled. Adapter capability flags are unchanged. Unknown work, invalid/expired leases and persistence failures stop renewed presence; shutdown clears the interval and idle wait. Maintenance calls are serialized and a lookup finishing after stop cannot start a new heartbeat. An already-issued database write can finish after stop; its timestamp expires naturally in the dashboard window. No provider requests or model usage are introduced by idle maintenance.
