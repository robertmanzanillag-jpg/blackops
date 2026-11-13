# BlackOps CEO Assistant - Plan de Trabajo

## Objetivo

Convertir BlackOps Reminder en un CEO Assistant personal: un sistema que entiende agenda, tareas, proyectos, inversiones, riesgos, aprobaciones y comunicaciones, con Telegram como canal principal de conversación y briefing diario.

## Estado Actual

- App full-stack con React, Express, Drizzle y PostgreSQL.
- Dashboard, assistant chat, portafolio, radio, proyectos, GitHub/code agents.
- Telegram ya recibe mensajes, procesa imagenes, guarda historial y conversa con contexto CEO.
- Trust layer en progreso: acciones pendientes, permisos, audit logs y aprobaciones.
- Contexto de usuario centralizado con `getCurrentUserId`, `resolveCurrentUserId`, `getSystemUserId` y middleware `requireAppUser`.
- Brief CEO matutino y test manual desde el dashboard CEO.
- Dashboard CEO con agenda, riesgos, aprobaciones, meeting prep, follow-ups, decisiones, personas clave y compromisos.
- Telegram webhook resuelve el owner por `chatId -> userId` cuando entra un mensaje.
- Telegram webhook rechaza chats desconocidos con instrucciones de vinculacion; no los auto-asigna a `DEFAULT_USER_ID`.
- CLI `npm run telegram:configure` permite vincular `chatId` a `userId` real sin depender del frontend.
- `telegram:configure --latest` puede tomar el ultimo chat de Telegram Updates despues de enviar `/start`.
- Brief CEO matutino se envia por cada usuario con Telegram activo, no solo por el fallback default.
- Recordatorios evening/weekly y news digest ya usan usuarios con Telegram activo.
- Proactive insights diarios ya se generan por owner con Telegram activo.
- Agent actions de radio, portfolio y video-edit task ya aceptan `userId` y el scheduler los ejecuta por owner.
- Webhook de Telegram soporta `TELEGRAM_WEBHOOK_SECRET` y valida el header oficial de Telegram.
- Webhook de Telegram deduplica `update_id` con storage persistente cuando la tabla existe y cae a memoria como fallback temporal.
- Setup de webhook soporta `TELEGRAM_WEBHOOK_URL` o `PUBLIC_APP_URL` para produccion fuera de Replit.
- CLI `npm run telegram:webhook` permite consultar status y registrar webhook real con `setup --execute`.
- Scheduler usa `SCHEDULER_TIMEZONE` y horas configurables para el brief CEO e insights.
- Scheduler diario usa una decision testeable para evitar duplicar brief/insights/news/evening el mismo dia.
- Telegram divide respuestas largas y briefs largos en varios mensajes para no truncar contenido.
- Auth boundary soporta `req.user` y `req.session`; `x-user-id` y mock quedan limitados a dev/test u opt-in, y `DEFAULT_USER_ID` queda reservado para system jobs.
- Auth local opcional soporta registro/login/logout con password hasheado y sesion Express; en produccion usa Postgres como session store cuando `DATABASE_URL` esta configurado.
- Frontend tiene gate de auth y pantalla de acceso para login/registro local cuando el backend responde 401.
- CLI `npm run auth:create-user` permite crear el primer usuario local sin abrir registro publico.
- APIs protegidas rechazan requests sin contexto de usuario cuando el fallback dev esta deshabilitado.
- Auth middleware permite callbacks externos necesarios como Telegram webhook y Zoho OAuth callback.
- Rate limiting de login/registro local y webhook Telegram usa storage persistente cuando la tabla existe y cae a memoria como fallback temporal.
- Endpoint `/api/ceo/readiness` agrega estado de auth, IA, Telegram, webhook, secret y scheduler para saber si el CEO Assistant esta listo.
- CLI `npm run ceo:readiness` ejecuta el mismo readiness desde terminal para validar deploys y smoke tests.
- CLI `npm run ceo:doctor` imprime checks de entorno y la secuencia exacta de comandos para activar el CEO Assistant.
- Runbook operativo `CEO_ASSISTANT_RUNBOOK.md` documenta env vars, setup de Telegram, readiness, smoke tests y pendientes de produccion.
- Utilidad `npm run user:migrate` permite dry-run y ejecucion controlada para mover datos de `mock-user-123` a un usuario real.
- Rutas criticas de tasks, weekly tasks y goals validan ownership antes de leer/modificar/borrar por ID.
- Rutas financieras criticas de investments, watchlist y price alerts validan ownership antes de modificar/borrar por ID.

## Arquitectura de Alto Nivel

- **Frontend**: React + Vite + Wouter + TanStack Query. La vista `/ceo` funciona como cockpit ejecutivo y consume endpoints REST.
- **Backend API**: Express registra rutas de calendario, tareas, portafolio, Telegram, aprobaciones, automatizaciones, memoria CEO y proyectos.
- **Persistencia**: Drizzle/PostgreSQL con tablas por dominio: tasks, reminders, investments, Telegram config, profile data, audit logs, pending actions, automations y chat history.
- **Assistant Layer**: el chat del app y Telegram construyen contexto desde calendario, tareas, portafolio, memoria, pending actions y brief CEO.
- **Auth Boundary**: `user-context` resuelve usuario desde provider/session/header/default y bloquea APIs sin identidad fuera de dev fallback.
- **Scheduler**: `reminder-scheduler` dispara recordatorios y ahora el brief CEO matutino.
- **Trust Layer**: `trust-policy` decide si una accion puede ejecutarse, debe quedar pendiente o debe bloquearse; `trust-executor` ejecuta acciones aprobadas.
- **Integraciones**: Telegram, Google/Zoho Calendar, GitHub, finance/market data, push notifications y generacion AI.

## Funciones CEO Implementadas

- Brief ejecutivo diario por Telegram y push.
- Recordatorios creados por usuario se envian al Telegram del owner correcto.
- Evening reminder, weekly reminder y portfolio news digest se generan por owner.
- Proactive insights se generan por owner.
- Scheduler diario descubre owners desde Telegram habilitado y push subscriptions para no excluir usuarios web/push.
- Radio slots summary, portfolio weekly report y video edit task corren por owner.
- Mantenimiento de arranque para deduplicar tareas corre por owners descubiertos, no solo por `DEFAULT_USER_ID`.
- Promo video daily scheduler sube outputs a Google Drive con owner explicito descubierto desde configuraciones Telegram habilitadas.
- Boton manual en `/ceo` para enviar el brief ahora.
- CLI `npm run ceo:send-brief` permite enviar un brief CEO real a Telegram para smoke test operativo.
- Chat de Telegram con contexto CEO, historial persistente y soporte de imagenes.
- Historial CEO compartido entre chat web y Telegram, separado por usuario y compatible con historial Telegram legacy.
- Comandos Telegram: `brief`, `resumen`, `agenda`, `prioridades`, `readiness`, `estado CEO`, `health`, `status`, `estado sistema`, `/start`, `/help`, `pendientes`, `aprobar ID`, `rechazar ID`.
- Dashboard CEO con prioridades, agenda, meeting prep, historial compartido web/Telegram, aprobaciones, riesgos, salud de apps, finance alerts, automation failures, Telegram health y CEO readiness.
- Memoria ejecutiva: decisiones, personas importantes y compromisos.
- Follow-ups ejecutivos con fecha, canal, prioridad y estado.
- Meeting intelligence inicial con preguntas sugeridas y contexto relacionado.
- Borradores de comunicacion como acciones pendientes bajo aprobacion.
- Auditoria de acciones sensibles y permisos por dominio.
- Hardening opcional del webhook Telegram con secret token.
- Health de Telegram reporta URL esperada, URL registrada, si coinciden y si la IA esta configurada para chat.
- Health de Telegram reporta la configuracion horaria del scheduler.
- Readiness CEO reporta estado agregado: `ready`, `warning` o `blocked`, con checks accionables, incluyendo si la IA esta configurada para chat.
- Dashboard CEO muestra readiness agregado y checks accionables en la primera pantalla.
- Telegram puede reportar CEO readiness desde el chat con `readiness` o `estado CEO`.
- Telegram puede reportar su propio estado operativo desde el chat con `health`, `status` o `estado sistema`.
- Chat y brief por Telegram soportan mensajes largos sin truncamiento.
- El chat web y Telegram leen/escriben una conversacion CEO compartida para continuidad entre canales.
- Endpoint `/api/ceo/conversation-history` expone el historial CEO reciente para mostrar continuidad en el dashboard.
- Pruebas focalizadas cubren clasificacion de comandos CEO, particion de mensajes largos, formato del brief CEO y decision diaria del scheduler.
- Pruebas focalizadas cubren auth boundary: provider/session/header/default y bloqueo de mock en produccion.
- Pruebas focalizadas cubren allowlist de callbacks publicos y bloqueo 401 para APIs protegidas sin usuario.
- Pruebas focalizadas cubren readiness CEO para estados ready/warning/blocked.
- Script `npm run test:ceo-assistant` corre la bateria focalizada de auth, readiness, scheduler, brief y Telegram.
- Runbook operativo disponible para configurar y validar el CEO Assistant end-to-end.
- Migracion de usuario dev documentada y cubierta por pruebas de plan de tablas.
- Ownership checks iniciales en rutas criticas por ID.
- Ownership checks iniciales en rutas financieras por ID.

## Brechas Actuales

- Auth real: el boundary ya soporta provider/session y bloquea mock en produccion; ya existe utilidad de migracion dry-run para datos dev, pero falta conectar proveedor real de login y ejecutar migracion en entorno real.
- Auth local: ya existe login/session propio como puente single-user con session store persistente en Postgres, pantalla de acceso y CLI para crear el primer usuario; falta decidir si se queda como proveedor oficial o se reemplaza por Clerk/Auth.js/Replit Auth.
- Telegram ownership real parcial: el webhook ya resuelve `chatId -> userId` y no auto-vincula chats desconocidos; brief, evening, weekly, news digest, proactive insights, recordatorios de usuario y agent actions principales usan owner real; falta auth real y terminar hardening multiusuario.
- Tests automatizados: `test:ceo-assistant` agrega auth boundary, auth local, session/db/env config, rate limit, ownership, code/GitHub security, Google Drive/Canva/Black Room guards, readiness, scheduler, brief, doctor, backup/restore, go-live, Telegram, chat web y migracion. Aun faltan pruebas runtime con cuentas reales.
- Inbox real: existen borradores y aprobacion, pero no envio externo real por email/Slack/WhatsApp/CRM.
- Meeting post-processing: falta extraer action items despues de reuniones y generar follow-ups automaticamente.
- Delegation OS dedicado: hoy se modela con follow-ups/commitments; falta un modelo formal de owner, status, escalation y SLA.
- Observabilidad: hay readiness, health, automation runs y go-live gate; faltan dashboards profundos de latencia/reintentos y monitoreo externo.
- Hardening: placeholders, secretos debiles, URLs no HTTPS, backup/restore, restore destructivo, Telegram webhook, rutas sensibles y artefactos locales ya tienen guardrails locales. Falta ejecutar backup/restore/smoke/go-live contra cuentas reales.

## Roadmap Recomendado

### Fase 1 - Cerrar Telegram CEO Single-User

- Verificar token, chat, webhook y `readyForBriefs` desde `/api/telegram/health`.
- Verificar estado agregado desde `/api/ceo/readiness`.
- Verificar estado operativo desde Telegram con `health`, `status` o `estado sistema`.
- Confirmar hora real del brief matutino en `reminder-scheduler` y mantener prueba anti-duplicados por dia.
- Mantener pruebas de formatter, scheduler y handlers Telegram con dependencias mockeadas; el pendiente real es probar con bot/chat/webhook productivos.
- Configurar `TELEGRAM_WEBHOOK_URL` o `PUBLIC_APP_URL`, configurar `TELEGRAM_WEBHOOK_SECRET`, y re-ejecutar setup webhook.
- Configurar `SCHEDULER_TIMEZONE`, `CEO_BRIEF_HOUR` y `CEO_BRIEF_MINUTE` segun la rutina real del usuario.

### Fase 2 - Auth y Ownership Real

- Elegir proveedor: Auth.js, Clerk, Replit Auth o auth propia con `express-session`/Passport.
- Conectar proveedor real para poblar `req.user` o `req.session.userId`.
- Mantener `DEFAULT_USER_ID` solo como config explicita de single-user/system jobs, no como auth silenciosa para requests.
- Mantener el mapeo Telegram `chatId -> userId` como fuente de owner para webhooks.
- Reemplazar usos de `getSystemUserId()` en jobs/webhooks por owner real de cada config/subscription.
- Auditar rutas por ID para evitar leer/modificar recursos de otro usuario.

### Fase 3 - CEO Operating System

- Convertir follow-ups/commitments en Delegation OS formal.
- Agregar statuses: pending, waiting, blocked, delegated, done, escalated.
- Crear vistas por persona/proyecto/fecha prometida.
- Generar escalaciones automaticas con aprobacion.
- Crear resumen semanal CEO: decisiones, progreso, atrasos, riesgos y proxima semana.

### Fase 4 - Communications Hub

- Integrar email primero como canal real de salida.
- Mantener todas las comunicaciones externas bajo approval antes de enviar.
- Agregar templates por persona/proyecto/contexto.
- Agregar inbox de borradores, respuestas sugeridas y seguimiento.
- Registrar en memoria CEO cada decision/comunicacion importante.

### Fase 5 - Production Hardening

- Test suite estable para API, assistant, Telegram, scheduler y trust layer.
- Observabilidad de webhooks/jobs con errores accionables y monitoreo externo.
- Rate limiting por usuario y por canal con storage persistente confirmado despues de `db:push`.
- Backups, migraciones, restore staging y go-live gate ejecutados con evidencia real.
- Documentacion de deploy, secretos y runbooks.

### Fase 6 - Handoff de Cuentas Reales

- Configurar secretos reales desde `CEO_ASSISTANT_ENV.example`, sin placeholders.
- Crear o migrar el usuario real, definir `DEFAULT_USER_ID` y apagar fallback dev.
- Imprimir `npm run ceo:handoff`, completar variables operativas como `REAL_USER_ID`, `TELEGRAM_CHAT_ID`, `BACKUP_LABEL`, `BACKUP_DIR` y `RESTORE_DATABASE_URL`, y ejecutar `npm run db:push`, `ceo:db-check`, `telegram:configure`, `telegram:webhook -- setup --execute`, `ceo:backup-check`, `ceo:backup`, `ceo:restore`, `ceo:doctor`, `ceo:readiness`, `ceo:smoke`, `ceo:send-brief` y `ceo:go-live`.
- Confirmar evidencia persistida de go-live desde dashboard CEO, `POST /api/ceo/go-live/evidence` o `npm run ceo:go-live -- --user-id="$REAL_USER_ID" --chat-id="$TELEGRAM_CHAT_ID" --confirm-check=backup_executed --note="backup manifest verified" --execute` para backup real, restore staging, brief real, comandos Telegram e historial compartido.

## Bloque 1 - Telegram Como CEO Channel

Estado: implementado inicial.

- Enviar un brief CEO todas las mananas por Telegram.
- Permitir comandos desde Telegram:
  - `brief`, `resumen`, `agenda`, `prioridades`
  - `/brief`, `/help`, `/start`
  - `health`, `status`, `estado sistema`
  - `pendientes`, `aprobaciones`
  - `aprobar ID`
  - `rechazar ID`
- Usar el contexto CEO dentro del chat de Telegram.
- Guardar historial en una conversacion persistente.
- Health endpoint y comando Telegram para verificar token, chat, enabled, webhook y scheduler.
- Boton para enviar el brief CEO ahora desde `/ceo`.
- Mantener acciones sensibles bajo aprobacion antes de ejecutar.
- Registrar decisiones y ejecuciones en audit logs.

## Bloque 2 - Executive Dashboard

Estado: implementado inicial.

- Prioridades del dia.
- Agenda del dia.
- Acciones pendientes de aprobacion.
- Riesgos operativos.
- Estado de proyectos/apps.
- Portafolio y alertas relevantes.
- Metas mensuales/anuales conectadas a tareas concretas.
- Telegram health y test manual de brief.
- Formularios para follow-ups, decisiones, personas y compromisos.

## Bloque 3 - CEO Memory

Estado: implementado inicial.

- Personas importantes.
- Empresas/proyectos via notas de persona/contexto.
- Decisiones tomadas.
- Preferencias del usuario.
- Compromisos y seguimientos.
- Fuente y confianza de cada dato.
- UI para revisar, agregar, editar y borrar memoria ejecutiva.

## Bloque 4 - Meeting Intelligence

Estado: implementado inicial.

- Brief previo a cada reunion.
- Contexto de asistentes y proyectos relacionados.
- Preguntas sugeridas.
- Follow-ups relacionados antes de la reunion.
- Pendiente: extraccion automatica de action items despues de reuniones.
- Pendiente: seguimientos automaticos con aprobacion.

## Bloque 5 - Delegation OS

Estado: implementado inicial.

- Tareas propias vs tareas delegadas.
- Duenos, fechas compromiso y estado via follow-ups/commitments.
- Recordatorios de seguimiento.
- Escalamiento de pendientes vencidos.
- Historial de quien debe que.
- Pendiente: modelo dedicado de estados por owner.

## Bloque 6 - Inbox and Communications

Estado: implementado inicial.

- Bandeja de decisiones: responder, delegar, archivar, agendar.
- Borradores de mensajes.
- Envio solo con aprobacion para comunicaciones externas.
- Integraciones futuras: email, Slack/Teams, WhatsApp o CRM.
- Borradores de comunicacion se crean como acciones pendientes `communications.send`.
- Al aprobarlos, quedan marcados como draft manual; no se envia nada externo.
- Pendiente: integraciones reales de envio externo.

## Bloque 7 - Automations

Estado: parcialmente implementado.

- Automatizaciones programadas visibles y editables.
- Runs con historial, errores y reintentos.
- Politicas de permisos por dominio: calendario, finanzas, codigo, comunicaciones.
- Modo autonomo solo para tareas seguras.

## Bloque 8 - Production Hardening

Estado: implementado local, pendiente runtime real.

- Auth local/sesion y boundary real implementados; pendiente decidir proveedor definitivo si se quiere multiusuario completo.
- Ownership checks y guardas single-owner cubren rutas CEO/Telegram/Clippers/Code/GitHub y rutas criticas auditadas.
- Tests focalizados y agregados pasan localmente.
- Backup/restore/go-live estan implementados con comandos seguros; pendiente ejecutarlos con Postgres/staging reales.
- Manejo de secretos evita leer o incluir `credentials/`, `secrets/`, `.env`, `.env.local` y `CEO_ASSISTANT_ENV` en tar local.

## Criterio de Exito

BlackOps se considera un CEO Assistant real cuando:

- Puedes hablarle por Telegram como al chat del app.
- Recibes un resumen ejecutivo diario sin abrir la app.
- Las acciones sensibles se proponen, se aprueban y quedan auditadas.
- El sistema identifica prioridades, riesgos, decisiones y follow-ups.
- La memoria del usuario mejora las respuestas sin perder control.
- El dashboard muestra el estado operativo completo en una pantalla.
- `ceo:doctor`, `ceo:readiness`, `ceo:db-check`, `ceo:backup-check`, `ceo:backup`, `ceo:restore`, `ceo:smoke`, `ceo:send-brief` y `ceo:go-live` pasan con cuentas reales.
