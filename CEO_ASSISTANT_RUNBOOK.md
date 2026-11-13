# CEO Assistant Runbook

Guia operativa para dejar BlackOps funcionando como CEO Assistant con Telegram como canal principal.

## 1. Variables requeridas

Usa `CEO_ASSISTANT_ENV.example` como plantilla para produccion.

Minimo para API/app:

- `DATABASE_URL`: conexion PostgreSQL usada por Drizzle.
- `AI_INTEGRATIONS_GEMINI_API_KEY`: requerida para chat del app y chat de Telegram.
- `DEFAULT_USER_ID`: usuario single-user explicito para system jobs en produccion; no autentica requests web/API.
- `ALLOW_DEV_USER_FALLBACK`: recomendado `false` en produccion para evitar `mock-user-123`.
- `SESSION_SECRET`: requerida para login con sesion en produccion; usa un secreto real aleatorio de al menos 32 caracteres.
- `LOCAL_AUTH_ENABLED`: usar `true` para activar auth local username/password en produccion.
- `ALLOW_LOCAL_AUTH_REGISTRATION`: usar `true` solo para crear usuario local inicial; apagar despues de crear el usuario.

Minimo para Telegram:

- `TELEGRAM_BOT_TOKEN`: token del bot.
- `PUBLIC_APP_URL` o `TELEGRAM_WEBHOOK_URL`: URL publica HTTPS que apunta al app.
- `TELEGRAM_WEBHOOK_SECRET`: secret token real, no placeholder, para validar `x-telegram-bot-api-secret-token`.
- `TELEGRAM_AUTO_SETUP_WEBHOOK`: mantener `false` por defecto; usar `true` solo si quieres que el servidor llame `setWebhook` al arrancar. El camino recomendado es setup explicito con CLI.

Scheduler:

- `SCHEDULER_TIMEZONE`: default `America/New_York`.
- `CEO_BRIEF_HOUR`: default `7`.
- `CEO_BRIEF_MINUTE`: default `0`.
- `INSIGHTS_HOUR`: default `8`.
- `NEWS_DIGEST_HOUR`: default `9`.
- `EVENING_REVIEW_HOUR`: default `21`.

Backup/restore:

- `CEO_BACKUP_DIR`: directorio local donde se preparan dumps y artefactos antes de moverlos a storage externo.
- `CEO_BACKUP_SECRETS_ENCRYPTED`: usar `true` solo si `CEO_ASSISTANT_ENV`, `.env`, `.env.local`, `credentials/` y `secrets/` estan cubiertos por backup cifrado fuera de la maquina.

Opcionales utiles:

- `FINNHUB_API_KEY`: noticias/market data.
- `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`: Zoho Calendar.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: push notifications.

### Handoff seguro de cuentas reales

Cuando el operador conecte cuentas, no pegues secretos en chats, issues, notas de go-live ni evidencia del dashboard. La evidencia persistida debe ser corta y no sensible: por ejemplo `backup manifest verified`, `restore probado en staging`, `brief recibido en Telegram` o `historial visible en dashboard`.

Orden recomendado para conectar sin mezclar responsabilidades:

1. Copiar `CEO_ASSISTANT_ENV.example` a un archivo local no versionado y completar secretos reales.
   Los CLIs operativos (`ceo:doctor`, `ceo:readiness`, `ceo:smoke`, `ceo:backup*`, `ceo:restore`, `telegram:*`, `auth:create-user`, `user:migrate`) cargan automaticamente `.env`, `.env.local`, `CEO_ASSISTANT_ENV` y variantes locales antes de leer `process.env`.
2. Crear o migrar el usuario real y configurar `DEFAULT_USER_ID="$REAL_USER_ID"` solo para jobs single-user.
3. Ejecutar `npm run db:push` y `npm run ceo:db-check -- --json`.
4. Enviar `/start` al bot real y vincularlo con `npm run telegram:configure -- --user-id="$REAL_USER_ID" --latest --execute`.
5. Registrar webhook con `npm run telegram:webhook -- setup --execute` y revisar `npm run telegram:webhook -- status`.
6. Ejecutar `npm run ceo:backup-check -- --json`; si hay archivos sensibles locales, confirmar primero backup cifrado externo y luego usar `CEO_BACKUP_SECRETS_ENCRYPTED=true`.
7. Ejecutar backup real, restore contra staging, smoke, brief real y comandos Telegram. Cuando `npm run ceo:smoke -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID"` pasa completo, guarda evidencia automatica `smoke_ready` para que el dashboard CEO pueda mostrar ese gate como verificado sin confirmacion manual.
8. Guardar evidencia no sensible desde el dashboard CEO, `POST /api/ceo/go-live/evidence` o `npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --confirm-check=backup_executed --note="backup manifest verified" --execute`.
9. Cerrar con `npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID"` hasta que reporte ready.

## 2. Configurar Telegram

Antes de tocar produccion, puedes imprimir el checklist completo:

```bash
npm run ceo:handoff
npm run ceo:doctor
```

Para un preflight automatizable en CI/deploy:

```bash
npm run ceo:doctor -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --json
```

`ceo:doctor` falla si detecta placeholders, secretos cortos, URL publica que no sea HTTPS, fallback dev habilitado o `DEFAULT_USER_ID` diferente al `--user-id` revisado.

Para correr el smoke test operativo completo sin enviar mensajes reales:

```bash
npm run ceo:smoke -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID"
```

Para incluir un brief real de Telegram dentro del smoke test:

```bash
npm run ceo:smoke -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --send-brief --execute
```

Para cerrar el gate final despues de verificar lo externo:

```bash
npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID"
npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --smoke-ready --backup-executed --restore-verified --brief-verified --telegram-commands-verified --conversation-history-verified
```

Los flags del segundo comando son una confirmacion temporal del CLI y se reportan como `source: runtime-flag`. El dashboard y `GET /api/ceo/go-live` no aceptan flags por URL; leen solo evidencia persistida. Para dejar evidencia auditable persistida, confirma cada check desde el dashboard CEO, usa `POST /api/ceo/go-live/evidence` o ejecuta:

```bash
npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --confirm-check=backup_executed --note="backup manifest verified" --execute
npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --confirm-check=restore_verified --note="restore probado en staging" --execute
npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --confirm-check=brief_verified --note="brief recibido en Telegram" --execute
npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --confirm-check=telegram_commands_verified --note="comandos Telegram verificados" --execute
npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --confirm-check=conversation_history_verified --note="historial visible en dashboard" --execute
npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --revoke-check=backup_executed --execute
```

Los checks manuales validos son `backup_executed`, `restore_verified`, `brief_verified`, `telegram_commands_verified` y `conversation_history_verified`. `smoke_ready` solo se confirma ejecutando `npm run ceo:smoke`; el CLI rechaza confirmarlo manualmente. La evidencia persistida guarda `source: manual` y `confirmedAt` sin guardar secretos.
El CLI `ceo:go-live` tambien intenta leer esa evidencia persistida para el `--user-id` indicado; si no puede leer la base, cae a los flags explicitos del comando.

1. Crear bot en Telegram con BotFather y guardar `TELEGRAM_BOT_TOKEN`.
2. Definir `PUBLIC_APP_URL=https://tu-dominio.com` o `TELEGRAM_WEBHOOK_URL=https://tu-dominio.com/api/telegram/webhook`.
3. Definir `TELEGRAM_WEBHOOK_SECRET`.
4. Levantar el servidor.
5. Enviar `/start` al bot.
6. Configurar el chat desde la app, endpoint de Telegram config, o CLI:
   `npm run telegram:configure -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --execute`.
   Si acabas de enviar `/start`, tambien puedes usar:
   `npm run telegram:configure -- --user-id="$REAL_USER_ID" --latest --execute`.
7. Validar status desde CLI: `npm run telegram:webhook -- status`.
8. Registrar webhook desde la app, `POST /api/telegram/setup-webhook`, o CLI: `npm run telegram:webhook -- setup --execute`. El servidor no registra el webhook automaticamente al arrancar salvo que `TELEGRAM_AUTO_SETUP_WEBHOOK=true`.

## 3. Validar readiness

Desde API:

- `GET /api/telegram/health`: valida token, IA, chat, webhook, secret, scheduler y readiness de brief/chat.
- `GET /api/ceo/readiness`: valida auth, IA, Telegram, webhook secret y scheduler en una sola respuesta.
- `GET /api/ceo/go-live`: muestra el gate final de salida a produccion para el usuario autenticado; el dashboard CEO tambien lo muestra con checks faltantes y siguiente evidencia. No acepta flags query para marcar checks como listos; solo lee evidencia persistida y configuracion del owner autenticado.
- `POST /api/ceo/go-live/evidence`: guarda o revierte una confirmacion manual no sensible por usuario para un check de go-live (`checkId`, `confirmed=true|false`, `note` opcional de maximo 240 caracteres). No guardes tokens, dumps, URLs privadas ni secretos; la evidencia guarda `checkId`, `confirmedAt`, `source` y nota corta para mostrar auditoria basica en el dashboard.
- `GET /api/ceo/conversation-history?limit=6`: valida que el chat web y Telegram comparten historial CEO reciente.
- `GET /api/auth/me`: valida si hay sesion activa.
- `npm run ceo:readiness -- --user-id="$REAL_USER_ID"`: valida readiness sin depender del frontend.
- `npm run ceo:doctor -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --json`: preflight parseable para env/auth/scheduler/Telegram.
- `npm run ceo:db-check -- --json`: valida que el schema operativo exista en Postgres.
- `npm run ceo:backup-check -- --json`: valida herramientas de backup/restore, directorio destino y politica de artefactos sensibles.
- `npm run ceo:smoke -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID"`: preflight operacional combinado de doctor, schema, backup/restore preflight y readiness sin enviar brief. Si termina ready, persiste evidencia automatica `smoke_ready` para el dashboard/go-live. El restore real de staging se valida aparte con `ceo:restore`.
- `npm run ceo:smoke -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --send-brief --execute`: preflight combinado y envio real de brief CEO; si termina ready, tambien persiste `smoke_ready`.
- `npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID"`: gate final parseable; no declara ready hasta confirmar smoke, backup real, restore staging, brief real, comandos Telegram y continuidad de historial. Los flags explicitos del CLI sirven para una verificacion temporal; la evidencia persistida debe quedar por dashboard, `POST /api/ceo/go-live/evidence` o `--confirm-check=<check-id> --note=<nota-no-sensible> --execute`. Para corregir una confirmacion equivocada, usa `--revoke-check=<check-id> --execute`.
- `npm run telegram:configure -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --execute`: vincula Telegram al owner real.
- `npm run telegram:configure -- --user-id="$REAL_USER_ID" --latest --execute`: vincula el ultimo chat que envio `/start`.
- `npm run telegram:webhook -- status`: valida URL registrada, URL esperada, pendientes y ultimo error.
- El webhook no auto-vincula chats desconocidos a `DEFAULT_USER_ID`; un chat nuevo debe conectarse con el panel web o `telegram:configure`.

Desde Telegram:

- `health` o `estado sistema`: diagnostico tecnico de Telegram.
- `readiness` o `estado CEO`: readiness agregado del CEO Assistant.
- `brief`, `resumen`, `agenda`, `prioridades`: contexto CEO actual.
- `top 3` o `foco`: tres prioridades principales.
- `bloqueos` o `riesgos`: atascos operativos detectados.
- `a quien tengo que perseguir`: follow-ups vencidos y compromisos abiertos.
- `cerrar dia`: checklist ejecutivo para terminar el dia.
- `pendientes`: acciones esperando aprobacion.
- `aprobar ID` / `rechazar ID`: aprobar o bloquear acciones sensibles.

## 4. Validar brief matutino

1. Confirmar `SCHEDULER_TIMEZONE`, `CEO_BRIEF_HOUR` y `CEO_BRIEF_MINUTE`.
2. Confirmar que `GET /api/telegram/health` tenga `readyForBriefs: true`.
3. Probar envio manual con `POST /api/telegram/test-ceo-brief`.
4. Probar envio manual desde terminal con `npm run ceo:send-brief -- --user-id="$REAL_USER_ID" --execute`.
5. Confirmar llegada del mensaje en Telegram.
6. Validar que no se trunque: mensajes largos se dividen automaticamente.

## 5. Smoke test local

Ejecutar:

```bash
npm run ceo:verify-local
npm run test:ceo-assistant
```

Cubre:

- Auth boundary y callbacks publicos.
- Ownership de alertas/manual tests/Zoho/market updates para evitar acciones sobre el usuario equivocado.
- CEO readiness.
- CEO doctor/checklist.
- Scheduler diario y anti-duplicados.
- Formato del brief CEO.
- Comandos Telegram, historial compartido, dedupe de webhook y particion de mensajes largos.

## 6. Schema y multiinstancia

Antes de correr mas de una instancia del backend, aplicar el schema en Postgres:

```bash
npm run db:push
npm run ceo:db-check -- --json
```

Esto crea/actualiza tablas operativas como:

- `telegram_processed_updates`: deduplica `update_id` de Telegram entre instancias.
- `app_rate_limit_buckets`: comparte rate limits de auth local y webhook Telegram entre instancias.

Si esas tablas aun no existen, el backend cae temporalmente a memoria y registra un warning, pero eso no protege completamente contra duplicados o abuso entre procesos.

## 7. Backup y restore

Antes de operar con datos reales, confirmar que el entorno puede respaldar y restaurar:

```bash
npm run ceo:backup-check -- --json
```

El chequeo requiere:

- `DATABASE_URL` configurado.
- Herramientas `pg_dump`, `pg_restore`, `psql` y `tar` disponibles.
- `CEO_BACKUP_DIR` escribible.
- Si existen `CEO_ASSISTANT_ENV`, `.env`, `.env.local`, `credentials/` o `secrets/`, `CEO_BACKUP_SECRETS_ENCRYPTED=true` solo despues de configurar backup cifrado fuera de la maquina.

El reporte imprime comandos auditables para:

- Crear el directorio de backup.
- Exportar Postgres con `pg_dump --format=custom`.
- Empaquetar artefactos locales no sensibles.
- Probar conexion con `psql`.
- Probar restore contra una base separada con `RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" pg_restore --clean --if-exists`; nunca contra `DATABASE_URL`.

Para ejecutar un backup real:

```bash
npm run ceo:backup -- --label="$BACKUP_LABEL"
npm run ceo:backup -- --label="$BACKUP_LABEL" --execute
```

El backup real crea un subdirectorio dentro de `CEO_BACKUP_DIR` con `postgres.dump`, `local-artifacts.tgz` cuando hay artefactos locales, y `backup-manifest.json` con SHA-256/tamano de los archivos generados. El tar local incluye `revenue_engine_data`, `revenue_mockups`, `radio_video_edits`, `promo_video_edits` y `clippers_workspace` si existen. No incluye `CEO_ASSISTANT_ENV`, `.env`, `.env.local`, `credentials/` ni `secrets/`; esos artefactos requieren backup cifrado externo antes de operar con datos reales.

Para probar restore, usa una base destino separada. Por defecto el comando lee `RESTORE_DATABASE_URL`, no `DATABASE_URL`, para reducir el riesgo de pisar produccion. El restore rechaza `DATABASE_URL` y nombres ambiguos como `PRODUCTION_DATABASE_URL`; usa un env separado con nombre explicito de prueba como `RESTORE_DATABASE_URL`, `STAGING_DATABASE_URL` o `TEST_DATABASE_URL`.

```bash
RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" npm run ceo:restore -- --dump="$BACKUP_DIR/postgres.dump"
RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" npm run ceo:restore -- --dump="$BACKUP_DIR/postgres.dump" --artifacts="$BACKUP_DIR/local-artifacts.tgz" --manifest="$BACKUP_DIR/backup-manifest.json" --artifacts-output-dir="restored-artifacts/$BACKUP_LABEL" --confirm-restore --execute
```

El restore es destructivo sobre la base destino y exige `--confirm-restore` ademas de `--execute`. Si pasas `--manifest`, valida checksums del dump y del tar antes de tocar staging. Si pasas `--artifacts`, el tar se extrae en `--artifacts-output-dir`; no se debe extraer encima del workspace activo.

Puedes validar checksums sin tocar la base destino ejecutando el restore en dry-run con `--manifest`; si el dump o el tar no coinciden con `backup-manifest.json`, el comando falla antes de cualquier restore.

No guardes dumps ni artefactos sensibles en git. El directorio local debe ser una parada temporal antes de mover el respaldo a storage cifrado.

## 8. Criterio operativo de listo

El sistema esta listo para operar como CEO Assistant single-user cuando:

- `/api/ceo/readiness` responde `status: "ready"`.
- `npm run ceo:readiness -- --user-id="$REAL_USER_ID"` termina con exit code 0.
- `npm run ceo:db-check -- --json` termina con exit code 0.
- `npm run ceo:backup-check -- --json` termina con exit code 0.
- `npm run ceo:backup -- --label="$BACKUP_LABEL" --execute` genera `postgres.dump`, `backup-manifest.json` y, si hay artefactos locales, `local-artifacts.tgz`.
- `RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" npm run ceo:restore -- --dump="$BACKUP_DIR/postgres.dump" --artifacts="$BACKUP_DIR/local-artifacts.tgz" --manifest="$BACKUP_DIR/backup-manifest.json" --artifacts-output-dir="restored-artifacts/$BACKUP_LABEL" --confirm-restore --execute` valida checksums, restaura DB contra staging y verifica artefactos en un directorio separado.
- `npm run ceo:smoke -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID"` termina con exit code 0.
- `npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --smoke-ready --backup-executed --restore-verified --brief-verified --telegram-commands-verified --conversation-history-verified` termina con exit code 0.
- `/api/telegram/health` responde `readyForBriefs: true` y `readyForChat: true`.
- `/api/ceo/conversation-history` muestra mensajes recientes despues de conversar desde web o Telegram.
- `npm run test:ceo-assistant` pasa completo.
- `POST /api/telegram/test-ceo-brief` envia el brief real.
- `npm run ceo:send-brief -- --user-id="$REAL_USER_ID" --execute` envia el brief real desde CLI.
- En Telegram, `readiness`, `health`, `brief`, `pendientes`, `aprobar ID` y `rechazar ID` responden correctamente.
- Una conversacion iniciada en Telegram aparece como contexto reciente cuando continuas desde el chat del app, y viceversa.

## 9. Pendientes antes de produccion multiusuario

- Conectar proveedor real de auth para poblar `req.user` o `req.session.userId`.
- Si usas auth local temporal: configurar `SESSION_SECRET`, `DATABASE_URL`, `LOCAL_AUTH_ENABLED=true`, crear el usuario sin poner la contrasena en la linea del comando:
  `read -r -s LOCAL_AUTH_PASSWORD`
  `export LOCAL_AUTH_PASSWORD`
  `npm run auth:create-user -- --username="$LOCAL_AUTH_USERNAME" --password-env=LOCAL_AUTH_PASSWORD --print-user-id`
  `unset LOCAL_AUTH_PASSWORD`
- Usar el id impreso para migrar datos: `npm run user:migrate -- --from=mock-user-123 --to="$REAL_USER_ID" --execute`.
- Los comandos de auth/migracion y gates CEO rechazan placeholders literales como `<real-user-id>`, `<telegram-chat-id>` o `replace-with-password`; reemplazalos por valores reales antes de ejecutar.
- Mantener `ALLOW_LOCAL_AUTH_REGISTRATION=false` en produccion; el registro web queda solo para emergencias controladas.
- No dependas de `DEFAULT_USER_ID` para autenticar requests web/API; en produccion el usuario debe venir de sesion local o de un proveedor que llene `req.user`/`req.session`.
- Si el backend responde 401, el frontend muestra la pantalla de acceso local para login/registro.
- Migrar datos de `mock-user-123` al usuario real.
- Completar ownership por ID en rutas heredadas que todavia no fueron auditadas fuera del camino CEO/Telegram; portfolio, DJ contacts, monitored projects, weekly summaries y acciones Clippers de cuenta/credenciales/plataforma/imports/records/render/automation/permisos/fuentes/trends ya cubren operaciones por id/accion con usuario autenticado.
- Clippers sigue en modo single-owner mientras `clippers_workspace`, OAuth/token vault y artefactos de launch sean locales/compartidos; el API rechaza usuarios distintos de `DEFAULT_USER_ID`, y los callbacks OAuth publicos guardan `ownerUserId` en conexiones y token vault para auditoria.
- Health/readiness de Telegram y `/api/ceo/readiness` ya tienen builder compartido con pruebas ejecutables contra placeholders y configuracion real. `handleTelegramMessage` ya tiene pruebas con dependencias mockeadas para chat desconocido, auto-enable de chat vinculado y guardado de historial sin tocar DB ni red. El scheduler principal ya tiene pruebas de flujo para morning brief, evening reminder, weekly reminder, proactive insights, radio template generation, agent actions programadas, recordatorios creados por usuario y digest diario de noticias con owners descubiertos, push, Telegram, skipped, deduplicacion diaria y registro de automation run mockeados.
- Rate limiting de auth local y webhook Telegram ya usa Postgres cuando `app_rate_limit_buckets` existe; confirmar `npm run db:push` antes de escalar.
- Dedupe de Telegram por `update_id` ya usa Postgres cuando `telegram_processed_updates` existe; confirmar `npm run db:push` antes de escalar.
- El scheduler diario procesa owners descubiertos por Telegram habilitado y push subscriptions; `DEFAULT_USER_ID` queda como fallback single-user.
- La deduplicacion de tareas al arrancar procesa owners con Telegram habilitado y usa `DEFAULT_USER_ID` solo como fallback single-user.
- Promo video daily scheduler procesa owners con Telegram habilitado y usa `DEFAULT_USER_ID` solo como fallback single-user para uploads a Drive.
- Mantener una prueba periodica de restore usando el dump generado por `npm run ceo:backup -- --execute` y restaurado contra una base separada con `ceo:restore`.

## 10. Migrar datos del usuario dev

Antes de conectar auth real, auditar datos actuales:

```bash
npm run user:migrate -- --from=mock-user-123 --to="$REAL_USER_ID"
```

Ese comando es dry-run: imprime cuantas filas se moverian por tabla y bloquea conflictos en tablas de configuracion unica.

Para aplicar:

```bash
npm run user:migrate -- --from=mock-user-123 --to="$REAL_USER_ID" --execute
```

Despues de aplicar:

- Configurar `DEFAULT_USER_ID="$REAL_USER_ID"`.
- Poner `ALLOW_DEV_USER_FALLBACK=false`.
- Revisar `/api/ceo/readiness`.
- Enviar `readiness` en Telegram.
- Ejecutar `npm run test:ceo-assistant`.
