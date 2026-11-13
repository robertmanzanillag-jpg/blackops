# CEO Assistant Handoff

Checklist corto para conectar cuentas reales sin compartir secretos en chat, notas o evidencia.

Para imprimir esta hoja en terminal:

```bash
npm run ceo:handoff
```

Para validar el estado local antes de conectar cuentas reales:

```bash
npm run ceo:verify-local
```

## Regla de seguridad

- No pegues tokens, passwords, dumps, URLs privadas ni contenidos de `.env`, `.env.local`, `CEO_ASSISTANT_ENV`, `credentials/` o `secrets/` en evidencia.
- Las notas de go-live deben ser no sensibles, por ejemplo: `backup manifest verified`, `restore probado en staging`, `brief recibido en Telegram`, `historial visible en dashboard`.
- Completa las variables shell de abajo antes de ejecutar comandos. No uses valores `replace-*` en produccion.

```bash
export LOCAL_AUTH_USERNAME=ceo-admin
export REAL_USER_ID=replace-after-auth-create-user
export TELEGRAM_CHAT_ID=replace-after-telegram-start
export BACKUP_LABEL=$(date +%F)
export BACKUP_DIR=$CEO_BACKUP_DIR/$BACKUP_LABEL
export RESTORE_DATABASE_URL=replace-with-staging-postgres-url
```

## Orden operativo

1. Configurar secretos reales desde `CEO_ASSISTANT_ENV.example` en un archivo local no versionado. Los CLIs operativos cargan `.env`, `.env.local`, `CEO_ASSISTANT_ENV` y variantes locales automaticamente.
2. Crear o migrar usuario real:
   `read -r -s LOCAL_AUTH_PASSWORD`
   `export LOCAL_AUTH_PASSWORD`
   `npm run auth:create-user -- --username="$LOCAL_AUTH_USERNAME" --password-env=LOCAL_AUTH_PASSWORD --print-user-id`
   `unset LOCAL_AUTH_PASSWORD`
   `npm run user:migrate -- --from=mock-user-123 --to="$REAL_USER_ID" --execute`
3. Confirmar schema:
   `npm run db:push`
   `npm run ceo:db-check -- --json`
4. Conectar Telegram:
   enviar `/start` al bot real
   `npm run telegram:configure -- --user-id="$REAL_USER_ID" --latest --execute`
   `npm run telegram:webhook -- setup --execute`
   `npm run telegram:webhook -- status`
5. Revisar entorno completo:
   `npm run ceo:doctor -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID"`
   `npm run ceo:readiness -- --user-id="$REAL_USER_ID"`
6. Confirmar backup y restore:
   `npm run ceo:backup-check -- --json`
   `npm run ceo:backup -- --label="$BACKUP_LABEL" --execute`
   `RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" npm run ceo:restore -- --dump="$BACKUP_DIR/postgres.dump" --artifacts="$BACKUP_DIR/local-artifacts.tgz" --manifest="$BACKUP_DIR/backup-manifest.json" --artifacts-output-dir="restored-artifacts/$BACKUP_LABEL" --confirm-restore --execute`
7. Probar runtime real:
   `npm run ceo:smoke -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID"`
   `npm run ceo:send-brief -- --user-id="$REAL_USER_ID" --execute`
   Si `ceo:smoke` termina ready, deja evidencia automatica `smoke_ready` para el dashboard/go-live.
8. Probar en Telegram real: `health`, `readiness`, `brief`, una conversacion normal, `pendientes`, `aprobar ID`, `rechazar ID`.
9. Confirmar continuidad: una conversacion iniciada en Telegram aparece en `/api/ceo/conversation-history` y en el dashboard CEO.
10. Cerrar salida:
    `npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID"`
    `npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --smoke-ready --backup-executed --restore-verified --brief-verified --telegram-commands-verified --conversation-history-verified`

## Evidencia persistida

Usa el dashboard CEO o `POST /api/ceo/go-live/evidence` para guardar evidencia no sensible de:

- `backup_executed`
- `restore_verified`
- `brief_verified`
- `telegram_commands_verified`
- `conversation_history_verified`

El check `smoke_ready` viene de ejecutar `npm run ceo:smoke`; no se confirma manualmente.

Alternativa por terminal:

```bash
npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --confirm-check=backup_executed --note="backup manifest verified" --execute
npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --confirm-check=restore_verified --note="restore probado en staging" --execute
npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --confirm-check=brief_verified --note="brief recibido en Telegram" --execute
npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --confirm-check=telegram_commands_verified --note="comandos Telegram verificados" --execute
npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --confirm-check=conversation_history_verified --note="historial visible en dashboard" --execute
npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --revoke-check=backup_executed --execute
```
