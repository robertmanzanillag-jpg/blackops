# Tarea: activar CEO Assistant y Dropshipping para trabajo real

Prioridad: alta
Fecha sugerida: 2026-06-19
Estado: lista para crear en la app cuando `DATABASE_URL` este configurado.

## Objetivo

Conectar las cuentas reales, validar seguridad/backup, activar Telegram, preparar Shopify/checkout y dejar Dropshipping CEO listo para operar con approvals antes de gastar o publicar.

## Checklist operativo

1. Crear `.env` local desde `CEO_ASSISTANT_ENV.example` sin subir secretos a GitHub.
2. Configurar `DATABASE_URL`, `SESSION_SECRET`, `AI_INTEGRATIONS_GEMINI_API_KEY` o proveedor AI disponible, `PUBLIC_APP_URL` o `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_SECRET`.
3. Crear usuario admin real con `npm run auth:create-user` y guardar `REAL_USER_ID`.
4. Migrar datos del usuario mock si aplica con `npm run user:migrate -- --from=mock-user-123 --to="$REAL_USER_ID" --execute`.
5. Definir `DEFAULT_USER_ID=$REAL_USER_ID` para trabajos single-user/background.
6. Aplicar schema con `npm run db:push`.
7. Confirmar DB con `npm run ceo:db-check -- --json`.
8. Conectar Telegram: crear bot, mandar `/start`, ejecutar `npm run telegram:configure -- --user-id="$REAL_USER_ID" --latest --execute`.
9. Configurar webhook de Telegram con `npm run telegram:webhook -- setup --execute` y validar `npm run telegram:webhook -- status`.
10. Ejecutar `npm run ceo:doctor -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID"`.
11. Ejecutar `npm run ceo:readiness -- --user-id="$REAL_USER_ID"`.
12. Confirmar backup preflight con `npm run ceo:backup-check -- --json`.
13. Ejecutar backup real con `npm run ceo:backup -- --label="$BACKUP_LABEL" --execute`.
14. Probar restore en staging con `npm run ceo:restore` usando `RESTORE_DATABASE_URL`, `--confirm-restore` y `--execute`.
15. Ejecutar smoke real con `npm run ceo:smoke -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID"`.
16. Enviar brief real con `npm run ceo:send-brief -- --user-id="$REAL_USER_ID" --execute`.
17. Probar Telegram: `health`, `readiness`, `brief`, conversacion normal, `pendientes`, `aprobar ID`, `rechazar ID`.
18. Confirmar que la conversacion de Telegram aparece en `/api/ceo/conversation-history` y dashboard CEO.
19. Conectar Shopify: `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN` o OAuth segun flujo disponible.
20. Crear producto Dropshipping como `DRAFT`, no publicarlo directo.
21. Confirmar payment processor, tax, shipping, refund, privacy y terms.
22. Hacer una orden de prueba antes de vender real.
23. Elegir supplier principal y backup; confirmar rating, reviews, stock, tracking, returns y rango de shipping.
24. Comprar sample solo con approval y dentro del budget si el producto lo requiere.
25. Conectar redes o mantener publishing manual al inicio.
26. Publicar solo contenido organico aprobado.
27. Mantener ads en `$0` hasta tener tracking, senal organica, cap diario y approval.
28. Migrar approvals locales en Dropshipping CEO > Approvals: primero `Revisar`, luego `Migrar`.
29. Cerrar gate final con `npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID"`.
30. Guardar evidencia no sensible de backup, restore, brief, comandos Telegram e historial en dashboard/API/CLI.

## Guardrails

- No pegar tokens, passwords, dumps, URLs privadas ni `.env` en chat o GitHub.
- No comprar inventario.
- No publicar producto real sin draft revisado.
- No gastar en ads sin tracking, cap diario y approval.
- No contactar proveedor, publicar social, comprar sample ni fulfill sin approval.
- No prometer shipping exacto sin evidencia.
- No usar claims medicos, marcas ajenas ni guarantees absolutas.

## Comando para crear esta tarea en la app

Cuando `DATABASE_URL` exista y el schema este aplicado:

```bash
npm run ceo:create-go-live-task -- --user-id="$REAL_USER_ID" --execute
```
