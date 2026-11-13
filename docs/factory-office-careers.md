# Factory engineers in the Agents Office

The Software Factory's four proposal stages are main-company careers (never KONG), shown in the 3D office in the department "Ingeniería / Fábrica":

| Career | Stage | Attributable failure (−10) |
| --- | --- | --- |
| `factory-scout` | `discover` (order discovery + file selection) | billed selection rejected by the code validator: `FACTORY_AUTO_SELECTION_INVALID`, `_PATHS_INVALID`, `_PATH_DENIED`, `_PATH_NOT_FOUND`, `_TEST_PATH_REQUIRED` (only with cost > 0) |
| `factory-builder` | `build` | unusable patch `FACTORY_REMOTE_BUILD_FAILED:{PATCH, EDIT_PATH_NOT_ALLOWED, OVERLAPPING_EDITS, EDIT_LIMIT_EXCEEDED, MALFORMED_JSON, INVALID_EDIT_SHAPE, INVALID_EDIT_TEXT, NONUNIQUE_EDIT, NON_TEXT_EDIT, EMPTY_PATCH}`; candidate checks failed `FACTORY_ACTIONS_CHECK_FAILED`, `FACTORY_REMOTE_CHECK_FAILED` (failed), `FACTORY_BUILD_CHECKS_FAILED`, `FACTORY_PERMANENT_REGRESSION_TEST_REQUIRED` (blocked) |
| `factory-qa` | `simulate` | none distinguishable (a negative verdict is the job done; read failures are infrastructure) |
| `factory-reviewer` | `review` | none distinguishable (a malformed independent review is stored exactly like a rejection) |

Rules are the existing ones in `shared/agent-company.ts` through `advanceCompany`: hire at 80, completed stage +6 (`working`), attributable failure −10 (`error`), max 100, retirement only at 0 with ≥ 24 h tenure, then generation + 1 at 60 in the academy (`<id>#<generation>` candidate trainee). Everything else that is terminal is exempt and never passed to `advanceCompany`, exactly like the reviewer's non-attributable errors: provider results (`PROVIDER_*`, output limit, refusal), missing/stale sources, credit/budget, daily cap, gates, transport, operator reconciliation, and an empty discovery (`FACTORY_NO_ACTIONABLE_FINDING`, `FACTORY_FINDING_ALREADY_TRACKED`). `unknown`, `running`, `pending` and deferred rows are not terminal and are reconsidered later.

## Scoring path (crash-safe)

`SOFTWARE_FACTORY_OFFICE_CAREERS_ENABLED=true` in the factory worker environment (default off) runs `server/software-factory-office-careers.ts` before order scheduling, beside the office review sweep. It reads only rows the factory store has already committed (`store.list(owner)`) and applies them in one durable council transaction (`updateOfficeExecution`), writing `officeExecution.factoryCareers` (ledger of processed evidence ids `factory:<jobId>:<stage>:<repairAttempts>` plus last observed presence) in that same transaction. A crash before commit is repaired by the next sweep; a crash after commit cannot score twice (ledger + `evaluatedEvidenceIds`). The factory worker was chosen over the office worker because only it is guaranteed to reach the configured factory store (the object backend is configured only there) and it already holds the council store. Jobs completed before a career's `hiredAt` (history before enabling, or a retired generation) are recorded `before_hire`; results while a successor is in the academy are recorded `in_training`; both are never scored later. The ledger keeps 500 entries; anything completed at or before `evictedThrough` is never processed again. A sweep failure is logged and never blocks scheduling. No provider call, GitHub write, merge, dispatch or guardrail change (draft PRs, write scope, daily cap, credit ledger).

Latency: scores and persisted "last worked at" are updated at the start of the next factory run (a paused factory does not sweep).

## Presence (read-only)

`GET /api/agent-council/state` returns `factoryAgents`. For the owner it overlays a read-only `store.list(owner)` (cached 30 s, 3 s timeout, minimal projection: stage, status, lease/completion time). An engineer is `working` only while a stage lease is live; otherwise the office shows "Último trabajo" from the live rows or the persisted observation. Other users see only the persisted observation. A browser request never writes (no hire, no score, no presence write).

## Better engineers (successors)

Retirement, successor generation and trainee creation are the unchanged `advanceCompany` flow. With `OFFICE_ACADEMY_PREPARATION_ENABLED=true` the existing scheduler also prepares incumbent/candidate trainees for the factory careers. Qualification is **not** faked: `reserveAcademyReview` marks them "No verified training adapter is installed for this role", so a successor stays in the academy and cannot graduate without three held-out assessments that strictly improve on the incumbent with no cost/time regression.

Still needed before a factory successor can qualify:

- `factory-reviewer`: the office reviewer benchmark fixtures (`REVIEW_BENCHMARK_TASKS`) are the right task type, but the factory review stage (`server/software-factory-asistente-review.ts`) uses fixed instructions and does not read a role policy. A promoted policy would not change factory behaviour until that stage reads the council's active policy guidance; wiring the benchmark first would be a fake promotion.
- `factory-scout`: held-out (order text, repository listing, expected path set) fixtures graded by the existing `validateFactoryOrderPaths` plus recall/precision against the expected set, with priced receipts from the shared credit ledger.
- `factory-builder`: held-out (base SHA, order, expected regression test) fixtures run through the existing checks workflow in a sandbox, graded by checks passing and diff size, with priced receipts.
- `factory-qa`: its checks are deterministic artifact readers; a successor is only meaningful once QA gains a model-driven component.

Validation: `tests/factory-office-agents.test.ts` (roster/KONG separation, live presence, +6/−10 and exemptions, idempotency incl. CAS replay and restart, retirement → successor → academy blocker, no browser writes) and the new case in `tests/software-factory-asistente-operator.test.ts`. The new test file is not in the pinned `factory-candidate-checks.yml` list (adding it changes the workflow SHA-256 the operator configuration pins).
