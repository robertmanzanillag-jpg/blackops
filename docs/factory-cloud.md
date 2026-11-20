# Software factory in the cloud (no PC)

`.github/workflows/software-factory-cloud.yml` runs `script/software-factory-once.ts` on a clean
GitHub-hosted machine every two hours (and on demand from the Actions tab). Each run claims at most
four stages, exits as soon as the queue is idle, keeps unknown outcomes fenced (no replay) and stays
review-only / company-orders-only. The repository is public, so GitHub-hosted minutes are free.

## Activation (Robert)

Repository **Settings → Secrets and variables → Actions**:

Variables
- `SOFTWARE_FACTORY_CLOUD_ENABLED` = `true` (set to anything else to stop the schedule)
- `FACTORY_SOURCE_REF` = the branch in production (today `codex/office-integrated-repair-20261106`)

Secrets (the same reviewed values the factory already uses; never commit them)
- `FACTORY_DATABASE_URL` — production PostgreSQL URL; it must accept connections from outside Replit
- `FACTORY_OWNER_ID` — owner user id (used for `DEFAULT_USER_ID` and `SOFTWARE_FACTORY_OWNER_ID`)
- `FACTORY_OPENAI_API_KEY`
- `SOFTWARE_FACTORY_GITHUB_TOKEN`
- `OPENAI_SHARED_CREDIT_CONFIG_JSON` — fallback only: contents of the shared credit config file. The workflows
  first derive the config read-only from the ledger of `OFFICE_SHARED_CREDIT_SCOPE` (variable, else `.github/office-config.env`; default
  `openai-2026-11-19`) via `script/shared-credit-config-from-db.ts`, and use this secret only if that fails.
- `SOFTWARE_FACTORY_OPERATOR_CONFIG_JSON` — contents of the reviewed operator config file

Spending stays inside the existing shared credit ledger and the factory budget ($100/month).

## Safety
- Only `schedule` and `workflow_dispatch` triggers: pull requests and forks never see the secrets.
- `permissions: contents: read`; checkout without persisted credentials.
- Config files are written outside the checkout with mode 600 and removed after the run.
- One run at a time (`concurrency`), 45-minute job limit, SIGTERM before the hard stop.
- The worker prints only a static reason and the number of progressed stages.

## Stop / rollback
Set `SOFTWARE_FACTORY_CLOUD_ENABLED` to `false` (or pause the factory from the office). Removing the
workflow file also stops it. Any fenced job expires into "unknown" and is never replayed.

## Claude fallback (optional)

Add the secret `ANTHROPIC_API_KEY` (https://console.anthropic.com/settings/keys) to enable it. Optional
variables: `FACTORY_ANTHROPIC_MONTHLY_BUDGET_USD` (default `50`) and `FACTORY_ANTHROPIC_FALLBACK_ENABLED`
(`false` turns it off). Without the key the factory behaves exactly as before.

OpenAI stays first. A run uses `claude-opus-5-5` when the OpenAI shared credit cannot admit the job
(unavailable, expired, exhausted, uncertain, missing config/key), and a single call falls back when
OpenAI cannot admit or start it. Content/validation failures, unknown outcomes and corrupt or
mismatched OpenAI ledgers never fall back. Claude spend is held and settled in its own PostgreSQL
row (`factory-anthropic-budget-ledger-v2`); the monthly cap applies to the current month's settled
spend plus all open holds. Each artifact records `factory-model-provider:<provider>:<model>`.

### Operator recovery

- **Permanent block after an overrun or unknown outcome.** Like the OpenAI ledger, one settled row
  above its reservation (overrun) or one unknown row stops all new Claude admissions
  (`CREDIT_RECONCILIATION_REQUIRED`), and it does not clear at the month boundary. Recover in a
  maintenance window with the factory paused: confirm the real charge for that call in the Anthropic
  Console (Usage), then settle the unknown row with the trusted reconciliation path
  (`settle({ key, actualMicroUsd, evidenceId, reconciliation: { executionStopped: true } })`), using the
  console amount as evidence. An overrun row is already settled with its real usage; record the
  review, then provision a fresh ledger row (below) if new admissions are still required. Never
  delete individual rows or edit amounts by hand.
- **5000-entry row limit.** The row holds at most 5000 reservations (every model call and every
  admission adds one). When full, new admissions fail closed with `CREDIT_CAPACITY_REQUIRED`. To roll
  over: pause the factory, wait until no row is reserved/unknown, export the row
  (`agent_council_state` entry for the ledger owner key) to a private archive, then rename it to an
  archived owner key so the next run starts an empty row. Keep the archive: its settled admission
  receipts are the history that prevents re-admitting old orders, so re-check pending orders against
  it before unpausing.
- **Build recovery** (`docs/factory-build-recovery.md`) reads only the OpenAI ledger; a failed build
  whose model call ran on Claude fails closed there. Re-admit the order instead.
