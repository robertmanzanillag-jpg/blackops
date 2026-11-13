# Internal business deliverables

The existing PC office worker produces two bounded deliverables when `OFFICE_INTERNAL_WORK_ENABLED=true`:

- Automations: repair case files referencing each saved definition and its latest owner-scoped execution receipt. A suggested correction is not an executed repair.
- Portfolio: exact decimal arithmetic for saved quantities, transaction amounts and currency-separated recorded cost basis. Missing opening balances, transactions, transfers or splits remain unresolved; this does not verify broker balances or current market value.

The worker admits one task per role, UTC day and career generation. It reserves a fenced, expiring assignment before reading consistent SQL snapshots, and validates the generation again before committing. Missing or incomplete sources cannot produce a successful complete report. Uncertain executions remain visible and are not automatically repeated.

Evidence lives in the existing `revenue_engine_state` table under owner and kind `office_business_work_v1`. No schema creation runs on reads. History is bounded and never silently pruned. Readback recomputes the artifact and verifies its source and proof; a corrupted record fails closed.

`GET /api/agents-office/business-work` requires the authenticated system owner and returns `Cache-Control: no-store`. Opening the office panel only reads history. It does not start jobs, call AI, send messages, trade, modify automation schedules or increase permissions. The UI distinguishes stored deliverables from current activity, hides data after failed refresh and fences history across account changes.

These are narrow adapters, not qualification for the complete agent roles. They do not add those roles to `OFFICE_EXECUTABLE_ROLES`, manufacture academy scores, remove life or promote replacements. Full role qualification and production replacement still require the existing comparable evaluations and first verified execution.

Rollback: revert the worker hook and history route/component through a reviewed PR. Preserve the namespace for diagnosis; do not delete evidence or reset leases. Existing internal-work and training journals are unchanged.
