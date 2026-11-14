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
- `OPENAI_SHARED_CREDIT_CONFIG_JSON` — optional: contents of the shared credit config file. When empty, the
  workflows derive it read-only from the existing ledger in the database
  (`script/shared-credit-config-from-db.ts`, pricing and optional scope from `.github/office-config.env`).
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
