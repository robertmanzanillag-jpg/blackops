# Assistant Stabilization Plan

Plan para convertir el proyecto en un CEO Assistant operable, mantenible y listo para produccion real.

## Fase 0 - Compuertas tecnicas

Estado: completado localmente el 2026-06-17.

- `npm run check` debe pasar sin errores TypeScript.
- `npm run build` debe producir cliente y servidor.
- `npm run test:ceo-assistant` debe pasar completo.
- `npm run test:env-loader` debe cubrir el parser local de `.env`/`CEO_ASSISTANT_ENV` sin leer secretos reales.
- Tests focalizados de dominios grandes deben pasar cuando se toquen:
  - `node --import tsx --test tests/revenue-engine.test.ts`
  - `node --import tsx --test tests/clippers-agent.test.ts`
- `npm run ceo:smoke -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID"` debe ser el preflight operativo antes de declarar un deploy listo; cubre doctor, schema, backup/restore preflight y readiness. Backup y restore reales se ejecutan con `ceo:backup` y `ceo:restore`.

Cambios realizados:

- Tipos React/JSX y target TypeScript corregidos en `tsconfig.json`.
- Errores de `Timeout`, `Uint8Array`, narrowing de Revenue UI y contratos de Clippers corregidos.
- Inserciones Drizzle de storage/trust alineadas con tipos de tabla.
- Snapshot de portafolio alinea `userId` con el insert schema.

## Fase 1 - Produccion single-user real

Objetivo: que el asistente opere para Robert sin fallback silencioso de desarrollo.

- Configurar `DATABASE_URL`, `SESSION_SECRET`, `LOCAL_AUTH_ENABLED=true`, `ALLOW_DEV_USER_FALLBACK=false`.
- Crear usuario real con `export LOCAL_AUTH_USERNAME=ceo-admin`, `read -r -s LOCAL_AUTH_PASSWORD`, `export LOCAL_AUTH_PASSWORD`, `npm run auth:create-user -- --username="$LOCAL_AUTH_USERNAME" --password-env=LOCAL_AUTH_PASSWORD --print-user-id` y `unset LOCAL_AUTH_PASSWORD` para no dejar la contrasena en el historial del comando.
- Migrar datos desde `mock-user-123` con `npm run user:migrate -- --from=mock-user-123 --to="$REAL_USER_ID" --execute`.
- Configurar `DEFAULT_USER_ID=$REAL_USER_ID` para jobs single-user.
- Confirmar que requests web/API autentican por sesion/provider, no por `DEFAULT_USER_ID`.
- Configurar Telegram real: token, chat, webhook URL y `TELEGRAM_WEBHOOK_SECRET`.
- Bloquear deploy si `ceo:doctor` detecta placeholders, secretos debiles, URL no HTTPS, fallback dev o `DEFAULT_USER_ID` desalineado.
- Confirmar schema operativo con `npm run ceo:db-check -- --json` despues de `npm run db:push`.
- Confirmar backup/restore con `npm run ceo:backup-check -- --json` antes de operar con datos reales.
- Ejecutar backup real con `npm run ceo:backup -- --label="$BACKUP_LABEL" --execute` y probar restore contra staging con `RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" npm run ceo:restore -- --dump="$BACKUP_DIR/postgres.dump" --artifacts="$BACKUP_DIR/local-artifacts.tgz" --manifest="$BACKUP_DIR/backup-manifest.json" --artifacts-output-dir="restored-artifacts/$BACKUP_LABEL" --confirm-restore --execute`.
- Cerrar salida con `npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID"`; `smoke_ready` se prueba ejecutando `ceo:smoke`, mientras backup real, restore staging, brief, comandos Telegram e historial se confirman como evidencia externa persistida desde el dashboard CEO, `POST /api/ceo/go-live/evidence` o `npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --confirm-check=backup_executed --note="backup manifest verified" --execute`.
- Verificar:
  - `npm run ceo:doctor -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --json`
  - `npm run ceo:db-check -- --json`
  - `npm run ceo:backup-check -- --json`
  - `npm run ceo:backup -- --label="$BACKUP_LABEL" --execute`
  - `RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" npm run ceo:restore -- --dump="$BACKUP_DIR/postgres.dump" --artifacts="$BACKUP_DIR/local-artifacts.tgz" --manifest="$BACKUP_DIR/backup-manifest.json" --artifacts-output-dir="restored-artifacts/$BACKUP_LABEL" --confirm-restore --execute`
  - `npm run ceo:readiness -- --user-id="$REAL_USER_ID"`
  - `npm run ceo:smoke -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID"`
  - `npm run ceo:send-brief -- --user-id="$REAL_USER_ID" --execute`
  - `npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --smoke-ready --backup-executed --restore-verified --brief-verified --telegram-commands-verified --conversation-history-verified`

## Fase 2 - Observabilidad y operacion

Objetivo: saber que paso, que fallo y que requiere accion sin abrir logs crudos.

- Crear vista de jobs con ultima ejecucion, duracion, status, error y proximo intento.
- Exponer resumen de job health en `/api/ceo-dashboard` y en el dashboard CEO.
- Registrar `automation_runs` desde los jobs principales del scheduler para que el dashboard tenga historial real de success/failed/skipped.
- Persistir errores de scheduler, Telegram, IA, Drive/OAuth y revenue/clippers runs.
- Agregar retry metadata y dedupe persistente para jobs/webhooks si hay mas de una instancia.
  - Telegram webhook ya registra `update_id` en `telegram_processed_updates` y cae a dedupe en memoria si el schema aun no fue aplicado.
  - Rate limits de auth local y Telegram webhook ya usan `app_rate_limit_buckets` con fallback en memoria si el schema aun no fue aplicado.
- Mostrar en `/ceo` un bloque de "Sistema" con blockers accionables.
- Mantener `npm run ceo:smoke` como smoke command unico para doctor/schema/backup/readiness y brief real opcional bajo `--send-brief --execute`.
- El gate `ceo:go-live` no acepta evidencia manual persistida para `smoke_ready`; ese check debe venir de ejecutar el smoke. La evidencia persistida queda reservada para checks externos/manuales: backup real, restore staging, brief real, comandos Telegram e historial compartido. Esos checks se pueden confirmar/revocar desde dashboard/API o desde terminal con `--confirm-check=<check-id> --note=<nota-no-sensible> --execute` y `--revoke-check=<check-id> --execute`.
- `npm run ceo:backup-check -- --json` valida herramientas de backup/restore y politica de artefactos locales sensibles antes de produccion real.
- El backup local de artefactos (`local-artifacts.tgz`) cubre `revenue_engine_data`, `revenue_mockups`, `radio_video_edits`, `promo_video_edits` y `clippers_workspace`; excluye `CEO_ASSISTANT_ENV`, `.env`, `.env.local`, `credentials/` y `secrets/`, que requieren evidencia separada de backup cifrado externo con `CEO_BACKUP_SECRETS_ENCRYPTED=true`. Cada backup real escribe `backup-manifest.json` con checksums SHA-256 para validar restore.

## Fase 3 - Arquitectura modular

Objetivo: que nuevas capacidades no hagan mas fragil el proyecto.

- Dividir `server/routes.ts` por dominio:
  - `routes/tasks`
  - `routes/ceo`
  - `routes/telegram` - iniciado con `server/telegram-routes.ts`
  - `routes/finance`
  - `routes/revenue`
  - `routes/clippers`
  - `routes/integrations`
- Dividir agentes grandes en submodulos internos:
  - contratos/types
  - persistence
  - renderers
  - commands
  - tests por feature
- Mantener `npm run check`, `npm run build` y suites focalizadas como gate antes de merge/deploy.
- Frontend: rutas principales cargan por lazy loading para evitar que herramientas pesadas como Clippers y Revenue Engine inflen el bundle inicial.

## Fase 4 - CEO Operating System diario

Objetivo: que el asistente no sea solo herramientas, sino rutina ejecutiva.

Estado: parcial. Telegram ya soporta comandos deterministas de rutina (`top 3`, `bloqueos`, `a quien tengo que perseguir`, `cerrar dia`) alimentados por el mismo snapshot del brief CEO.

- Convertir follow-ups/commitments en Delegation OS:
  - owner
  - due date
  - status
  - blocked reason
  - escalation rule
  - last touch
- Brief diario debe producir:
  - top 3 prioridades
  - aprobaciones pendientes
  - riesgos nuevos
  - follow-ups vencidos
  - una recomendacion concreta de foco
- Dashboard CEO debe priorizar acciones sobre informacion.
- Telegram debe soportar comandos de rutina:
  - `top 3` - implementado localmente
  - `que bloqueo hay` - implementado localmente como `bloqueos`
  - `a quien tengo que perseguir` - implementado localmente
  - `aprobar/rechazar`
  - `cerrar dia` - implementado localmente

## Fase 5 - Multiusuario y hardening

Objetivo: escalar sin fugas de datos ni jobs duplicados.

Estado: parcial. `DEFAULT_USER_ID` ya no autentica requests ni auto-vincula chats Telegram desconocidos; Telegram webhook tiene dedupe persistente por `update_id`; auth local y webhook Telegram tienen rate limit persistente para reducir diferencias entre instancias; backup/restore tiene preflight local.

- Eliminar `DEFAULT_USER_ID` de rutas request-bound.
- Jobs siempre deben resolver owners desde config/subscription.
  - Scheduler diario ya descubre owners desde Telegram habilitado y push subscriptions; `DEFAULT_USER_ID` queda solo como fallback single-user si no hay owners.
  - Startup task dedupe ya descubre owners desde Telegram configs habilitadas y solo cae a `DEFAULT_USER_ID` cuando no hay owners configurados.
  - Promo video daily scheduler ya descubre owners desde Telegram configs habilitadas y pasa `userId` explicito a los uploads de Google Drive.
- Completar ownership checks por ID en rutas heredadas.
  - Portfolio summary/gains/rebalance/opportunities/report y test manual de market update ya usan el usuario autenticado y tienen prueba de regresion.
  - DJ contact update/delete/message ya verifican el owner antes de operar y tienen prueba de regresion.
  - Monitored project read/update/delete/check/logs/incidents ya verifican el owner antes de operar y tienen prueba de regresion.
  - Weekly summary update ya verifica el owner antes de mutar por id y tiene prueba de regresion.
  - Clippers daily plan, bootstrap, account setup/manual posting/production queue, credenciales/plataforma/OAuth, imports/records/render/automation y permisos/fuentes/trends/external execution request-bound ya reciben el usuario autenticado y tienen prueba de regresion.
  - Reportes guardados de Clippers ya persisten `userId`; `/api/clippers/reports/:id` exige el usuario autenticado antes de devolver un reporte y tiene pruebas de regresion.
  - Promo Video ya usa workspaces locales por usuario bajo `promo_video_edits/users/<user-id>`; status/source/import/delete/generate reciben el usuario autenticado y el script respeta `PROMO_OUTPUT_DIR` para no escribir salidas compartidas.
  - Revenue Engine ya no comparte los JSON globales por API: las rutas autentificadas usan `revenue_engine_data/users/<user-id>/*.json` con user id sanitizado y acceso serializado mientras el modulo mantenga arrays en memoria. Sigue pendiente migrarlo a tablas/storage transaccional por usuario para multiusuario real con concurrencia fuerte.
  - Code Agent y GitHub tools quedan bloqueados por API a usuarios distintos de `DEFAULT_USER_ID` hasta implementar permisos por usuario para filesystem, schema DB y repositorios remotos.
  - Clippers API queda bloqueada a usuarios distintos de `DEFAULT_USER_ID` mientras `clippers_workspace`, token vault y artefactos de launch sigan siendo locales y compartidos; aun asi, OAuth connections y token vault records ya guardan `ownerUserId` para dejar auditoria explicita del owner single-user.
  - OAuth callbacks publicos de Google Drive, Canva, Zoho y Clippers quedan exceptuados de auth request-bound solo para completar redirects externos; los endpoints de inicio/gestion siguen protegidos. En Clippers, el callback publico se vincula al `DEFAULT_USER_ID` configurado y no queda anonimo.
  - Paginas HTML de OAuth callback ya escapan texto dinamico antes de renderizarlo y Zoho ya no imprime refresh tokens en pantalla.
- Mover rate limit y Telegram dedupe de memoria a Postgres o Redis.
  - Telegram dedupe movido a Postgres con fallback en memoria.
  - Rate limit de auth local y Telegram webhook movido a Postgres con fallback en memoria.
- Agregar backup/restore probado para Postgres y artefactos locales importantes.
  - Preflight local implementado con `ceo:backup-check`; cubre artefactos locales no sensibles incluyendo `clippers_workspace` y separa el respaldo cifrado externo requerido para `CEO_ASSISTANT_ENV`, `.env`, `.env.local`, `credentials/` y `secrets/`.
  - Comandos ejecutables agregados: `ceo:backup` hace dry-run por defecto, requiere `--execute` y escribe `backup-manifest.json`; `ceo:restore` apunta por defecto a `RESTORE_DATABASE_URL`, requiere `--confirm-restore --execute`, puede validar `--manifest` antes de restaurar y puede extraer `local-artifacts.tgz` en un directorio separado para validar recuperacion de artefactos sin pisar el workspace.
  - `.gitignore` protege salidas locales generadas (`radio_video_edits`, `promo_video_edits`, `clippers_workspace`, `revenue_engine_data`, `revenue_mockups`, `backups`, `.backups`) para reducir riesgo de subir datos operativos por accidente.
  - Falta ejecutar backup real y prueba de restore contra entorno de produccion/staging.
