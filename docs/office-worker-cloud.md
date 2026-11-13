# Office executor in the cloud (no PC)

`node --import tsx script/office-worker-once.ts` runs the reviewed office executor once and exits.
`.github/workflows/office-worker-cloud.yml` starts it every 15 minutes on a GitHub-hosted runner
(free for this public repository). The PC worker (`script/office-worker.ts`) is unchanged in
behavior; both entrypoints share `server/office-worker-assembly.ts`.

## Bounds and safety

- Configuration is validated with the Windows launcher's `parseWorkerConfig` and the same fixed
  review-only flags (`safeWorkerEnvironment`). Repository `.env` files are never loaded.
- Exclusive ownership: `pg_try_advisory_lock` on a dedicated session keyed by the owner hash. Busy
  means exit; a lock is never stolen or waited for. The lock is re-verified every cycle and every
  15 seconds; a lost lock ends the run. Use a direct PostgreSQL URL (not a transaction pooler).
- If any non-cloud executor (the PC worker) heartbeated in the last two minutes, the run exits
  (`pc-active`). Stop and pause the PC worker (`--stop`, disable the scheduled task) before enabling.
- The office protocol rollout record is verified before work and every cycle, as on the PC.
- One academy/business pass per invocation (the PC's 15-minute cadence), then queue polling every
  5 seconds. No claim starts with less than 6 minutes left (5-minute job lease plus settlement);
  the run budget is 13 minutes, the host timeout 15 minutes (SIGTERM), the job 25 minutes.
- Any unconfirmed cycle ends the run with exit code 1. Uncertain work keeps its fence and becomes
  `unknown` when its lease expires; it is never replayed.
- Pause: set the repository variable `OFFICE_WORKER_CLOUD_ENABLED` to anything but `true`. It is
  read at job start and checked every cycle; an active run can also be cancelled from Actions
  (SIGTERM/SIGINT are cooperative). Revoking the protocol rollout record also stops every executor.

## Office status signal

While a run is active the office shows the executor as ready (real heartbeat every 15 s). Between
runs it stays **blocked** (nothing is executing), but the reason now says it is a scheduled cloud
executor and when it last ran, instead of the generic "no recent signal" text. This message needs
the web change in `server/office-cloud-runtime.ts` to be deployed; the worker does not depend on it.
GitHub cron can be delayed under load; tasks wait in the queue until the next run.

Each run registers a new `office-cloud-<uuid>` row in `office_agent_workers` (as each PC start does).
