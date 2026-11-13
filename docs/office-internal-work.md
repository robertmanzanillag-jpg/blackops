# Internal CEO and assistant preparation

`OFFICE_INTERNAL_WORK_ENABLED=true` opts the dedicated worker into one CEO brief and one assistant saved-task agenda per UTC date. It requires the existing verified protocol, canonical owner and dedicated Postgres council store. No additional provider budget, connector, publishing, messaging, task mutation or approval is used. The Windows configuration allowlist must be deliberately extended before this flag can be supplied through that launcher; current installations remain off.

`GET /api/agent-council/internal-work` returns private artifacts only to the configured owner. The general council view excludes them. Each artifact contains the bounded source projection, database observation time, content digest and exact selected record IDs. All reads bind the owner in a repeatable-read, read-only transaction. Missing owner, query failure and invalid data block the result without reducing life. A source failure is not an empty successful agenda.

The selection contains up to 200 incomplete tasks (high priority first, then stored date/id) and 200 pending/draft/edited approvals. Total counts and incomplete coverage are explicit. Titles are capped at 500 characters. Saved timestamp values are displayed as stored, without assigning a timezone or claiming a current calendar sync. Recurrences are not expanded. UTC determines scheduling only, not the meaning of the saved dates.

Assignments reserve the existing role lease and persist their daily slot before reading sources. Completion, artifact and successful work evidence commit together. Replica races, restarts and changed generations are fenced. Expired or interrupted assignments become unknown and retain their lock until operator reconciliation; no blind retry. Completed/blocked artifacts have bounded retention; unknown fences are retained.

This is actual deterministic preparation, not a trained model improvement. Its measured contract verifies selected-record coverage and absence of invented items. No training graduation, superior candidate or automatic replacement is asserted from these checks. A future alternative implementation requires independently verified comparative tasks and a runtime handoff; retired roles without that candidate remain vacant. Existing reviewer qualification is unchanged.

Rollback: disable this flag, let an active cycle finish, preserve the private state and role leases, and reconcile any unknown execution before resuming. No schema migration or new empty local workspace is introduced.
