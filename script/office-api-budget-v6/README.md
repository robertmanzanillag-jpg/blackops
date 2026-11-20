# Guarded Office v6 API-budget backport

This is a source-only selective patch, not a full-tree deployment. Root-captured preimages bind twelve existing files. Four new authority/transport modules are complete reviewed payloads. The actual assistant 142, ai-router, store provider, Office protocol and `.replit` are hash guards only. `server/ai-model-router.ts` must remain absent. No guards/configuration are copied or backed up.

Reviewed canonical PRs: 448 (`6743402`, merged `d8fe932`) and 450 (`fb3b1f1`, merged `af55af3`), each exact head seven required checks passed. Scoped v6 code `96aae6c6718b437321031c4d3a418c94236020d5` was independently approved: fifteen of sixteen source postimages equal canonical transport source; only native Clippers translation is adapted with four reversible changes, preserving its actual routing. Independent v6 tests: 18 passed. Local source/context guards: three passed. Portable staging fixtures: fifteen passed in temporary directories, including all postimages/backups, guard drift, missing-router guard, mixed states, symlink/target collision, manifest tamper and preserved partial failure. Portable fixtures use synthetic full-file preimage/guard digests with the actual reviewed patch contexts; actual configuration and custom full-file sources are not included. A separate local run used the hash-verified twelve public actual preimages and fourteen tests passed. The portable suite verifies fifteen public postimages directly against repository source and the approved legacy Clips adaptation bounds.

## Source staging (operator only)

Run serially in the actual Replit project root. Substitute the final independently reviewed manifest digest delivered alongside the archive. Keep the package and backup outside the project.

```sh
python3 /tmp/office-api-budget-v6-stage-20261118/stage.py --root "$PWD" --manifest-sha 786da807c7bf5d480292d941b017aee0450077b531f2264c5afb85b5baad0a1e
python3 /tmp/office-api-budget-v6-stage-20261118/stage.py --root "$PWD" --manifest-sha 786da807c7bf5d480292d941b017aee0450077b531f2264c5afb85b5baad0a1e --backup /tmp/office-api-budget-v6-before-20261118 --apply
```

Default is dry-run, zero writes. Any context/prehash/config/absence mismatch stops. All sixteen files must be entirely pre-state or post-state. Existing-file patches require exactly one occurrence of each reviewed context, and the complete output must equal its pinned source hash. Four module dependencies are created first. Apply captures every public original in a private external backup before any mutation; protected configuration is never captured. Partial failure preserves the backup, progress journal and lock; stop for review, do not rerun or full-sync main. Idempotent all-post readback does not write. No flags are activated.

Read back sixteen source hashes and six protected guards after staging. Run actual-project tests and build before publish. An incomplete local scoped tree cannot substitute for actual build: it lacks unrelated `ceo-domain-policy` referenced by the exported assistant; its sole TypeScript error is that missing module. Canonical full-tree TypeScript passed. Root's actual deployed build remains mandatory.

## Separate table-only schema plan

`provision-table.mjs` uses the current process's existing PostgreSQL connection selection in memory; it does not load `.env`, print connection information or change grants. Workspace projection showed the default PostgreSQL backend and no external module, not deployed-process configuration proof. It refuses any nondefault/non-PostgreSQL or external-module selection. Use only in the intended actual project and operator connection; this helper does not establish primary/deployment identity.

```sh
node --import tsx /tmp/office-api-budget-v6-stage-20261118/provision-table.mjs
# Only after reviewing the dry-run scope and root's actual DB authorization:
node --import tsx /tmp/office-api-budget-v6-stage-20261118/provision-table.mjs --apply
```

Both paths hold the same advisory lock as the authority, validate public schema, exact text/jsonb columns, primary key and unchanged row count. The default creates/validates inside a transaction then ROLLBACKs; explicit apply commits only `CREATE TABLE IF NOT EXISTS public.software_factory_api_authority (owner_key text PRIMARY KEY, state jsonb NOT NULL)`. Existing rows are preserved. Fake-pool tests: three passed. No month, budget balance, historical checkpoint or pricing is initialized. Table creation does not make paid admission ready.

## Required operational limits

The fixed monthly ceiling remains 100 USD with manual month initialization. Historic cents and rounded provider UI figures are not a new global balance. Owner status should expose unresolved reconciliation and nullable authority remaining until an attributable operator checkpoint incorporates historical costs/holds. News execution `2763c249-cd43-4ead-b6a0-111f6d76715a` remains quarantined; neither this patch nor table provision authorizes replay, release or settlement. Unknown obligations carry across months. All runtimes must resolve to the same authority; unsupported external adapters remain held.

All paid calls require valid verified pricing, reserve, execution-window check and exact terminal usage settlement; unsupported media/stream/Gemini/remote-context methods hold before HTTP. Subscription CLI and local FFmpeg/Metricool work do not become model API charges. No model routing switch is included. No real provider request was used to test this patch.

Provider UI availability is not reconciled ledger authority. Pricing dimensions, availability and expiry must be reviewed privately by the operator using current official sources; no price catalog or model migration is configured here. Do not declare paid API active from tests, the table, or a provider balance display.
