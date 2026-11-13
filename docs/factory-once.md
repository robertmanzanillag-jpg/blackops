# Bounded proposal worker

`node --import tsx script/software-factory-once.ts` uses the fixed reviewed
Asistente operator. It never imports the repository environment loader or accepts
an adapter path/command-line parameter. The existing infinite worker is unchanged.

Required environment: `SOFTWARE_FACTORY_ENABLED=true`,
`SOFTWARE_FACTORY_STORAGE_BACKEND=postgres`, `AGENT_COUNCIL_STORAGE=postgres`,
`OPENAI_SHARED_CREDITS_REQUIRED=true`, `DATABASE_URL`, `DEFAULT_USER_ID`,
`SOFTWARE_FACTORY_OWNER_ID` (same owner), `OPENAI_API_KEY`,
`SOFTWARE_FACTORY_GITHUB_TOKEN`, `OPENAI_SHARED_CREDIT_CONFIG`, and
`SOFTWARE_FACTORY_OPERATOR_CONFIG`. Both config paths must be absolute; the
operator file must be outside the checkout. Install existing reviewed private
configuration, never create a grant or initialize a ledger on startup.

The runner processes at most four claimed stages, exits immediately on idle or
another active slot, and preserves unknown outcomes without replay. It maintains
active work every 15 seconds and refuses another claim with less than eleven
minutes remaining: the existing ten-minute lease plus one minute for claim and
settlement. Its run budget is thirty minutes after startup. A host timeout must
include separate startup and cleanup allowance. PostgreSQL factory queries use
10-second connection, 30-second statement and 35-second client query bounds.
The pool is closed on exit. Shared credit/council access reuses its existing pool.

SIGTERM/SIGINT abort the active adapter, then await its bounded settlement path.
An interrupted fenced job can remain running until the existing lease expires
into unknown; it is never declared completed or automatically replayed. Hard
host termination cannot guarantee graceful settlement. A stalled adapter ignoring
abort still requires the outer host timeout. The worker emits only a static
reason and progressed-stage count, not job data, credentials or provider text.

No schedule, cloud secrets, migration, publication adapter or production change
is installed by this component. The operator must remain review-only and
company-orders-only; a paused owner exits without admission. A finite invocation
is not a guarantee that delayed external CI will fit the unchanged job lease.
