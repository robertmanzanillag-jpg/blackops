# Revenue Engine Click-Path Audit

## Post-review paths

- `Herramientas avanzadas` opens `/revenue-engine/advanced` and preserves the full operational console.
- `Registrar depósito` requires a positive amount and payment evidence before recording `deposit_collected`.
- `Marcar perdido` requires explicit confirmation before recording `lost`.

## State map

- `view` controls the six operational queues.
- `selectedId` selects one draft without mutating backend state.
- `editing`, `subject`, and `body` own the correction form.
- React Query owns the server snapshot; every successful mutation refetches it.
- `notice` reports success or failure in a visible status region.

## Touchpoints

- **Por aprobar / Aprobados / Enviados / Respuestas / Ventas / Cerrados**: changes only `view`, clears stale notices, and exits edit mode. Final state matches the chosen queue.
- **Prospect row**: updates only `selectedId`, clears notices, and exits edit mode. Final state shows the selected draft.
- **Corregir**: opens labeled subject/body fields. It is disabled after sending.
- **Guardar corrección**: posts the edited copy, resets approval to draft on the server, refetches data, and moves the UI to Por aprobar. This prevents stale approval after content changes.
- **Aprobar**: posts explicit Robert approval, refetches data, and moves the draft to Aprobados without sending or spending.
- **Enviar**: disabled unless approved, unsent, and channel=email. It requires a browser confirmation immediately before the external action. Cancel leaves state unchanged.
- **Registrar respuesta / Registrar llamada**: visible only for sent drafts without an outcome; each records the selected outcome and moves the item to Respuestas.
- **Buscar prospectos**: filters the current queue only and does not mutate server state.

## Bugs found and fixed

- **CLICK-PATH-001 (High): missing transition** — the former approval control recorded a generic decision but did not reliably communicate the draft's final queue state. The simplified flow calls the dedicated draft approval endpoint and refetches the actual draft.
- **CLICK-PATH-002 (Medium): stale queue after correction** — editing an approved draft correctly reset backend approval, but the UI could remain in Aprobados. The success handler now changes the visible queue to Por aprobar.
- **CLICK-PATH-003 (Medium): misleading row status** — unsent drafts displayed `Enviado` when they had no outcome. Row text now derives from send state first and shows Pendiente de aprobación, Listo para enviar, Necesita corrección, or the real recorded outcome.

## Result

The primary Revenue Engine click paths end in the state promised by their labels. External sending remains explicitly gated and was not executed during QA.
