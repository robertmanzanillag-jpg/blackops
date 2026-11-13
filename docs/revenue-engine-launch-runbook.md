# Revenue Engine Launch Runbook

## Objetivo

Arrancar el Revenue Engine para vender websites premium, mockups y automatizaciones sin gastar mas de lo que entra.

## Reglas de arranque

- Research puede correr 24/7.
- Contacto externo no debe correr 24/7 al inicio.
- Mockups deben priorizar calidad sobre volumen.
- Paid data empieza en $0.
- Cualquier gasto pagado requiere Profit Guard y aprobacion.
- No se construye ni entrega si falta scope aprobado, deposito, QA o margen.
- El correo de negocio/API puede quedar pendiente; eso no bloquea contacto manual por contact form, Gmail/mailto manual o llamada corta.

## Estado listo para empezar

El sistema esta listo para empezar a moverse cuando `/revenue-engine` muestre el `Revenue Engine activation brief` y el comando local confirme el modo correcto:

- Research/dry-run: `npm run revenue:money-readiness -- --mode=research`
- Primer sprint con dinero controlado: `npm run revenue:money-readiness -- --mode=first-sprint`
- Money mode completo: `npm run revenue:money-readiness -- --mode=money-mode`
- Launch/deploy: `npm run revenue:money-readiness -- --mode=production-launch`

When `DATABASE_URL` is configured, the command hydrates durable state for
`DEFAULT_USER_ID`. Use `--user-id=<authenticated-owner-id>` to verify a different
owner explicitly; never use a sanitized folder name as the durable owner id.

La unica pieza permitida como pendiente por ahora es:

- Correo de negocio/API (`RESEND_API_KEY`, `REVENUE_ENGINE_FROM_EMAIL`, DNS/SPF/DKIM/DMARC).

Mientras eso queda pendiente, si se puede hacer:

- Buscar leads.
- Registrar y puntuar leads.
- Crear mockups premium.
- Generar drafts.
- Contactar manualmente por contact form.
- Usar Gmail/mailto manual.
- Llamar a leads A para pedir permiso de enviar el mockup.

No se debe hacer todavia:

- Enviar volumen masivo.
- Comprar listas/data.
- Usar SMS masivo.
- Prometer resultados garantizados.
- Publicar mockups sin aprobacion.
- Entregar trabajo sin deposito, scope y QA.

## Lead Radar 24/7

Configuracion recomendada inicial:

- Area: Miami.
- Nichos: med spas, gyms, restaurants.
- Research: 120 candidatos/dia.
- Leads calificados: 25-35/dia.
- Mockups: 5-8/dia.
- Contactos: 10/dia maximo.
- Gasto: $0 hasta cerrar cash.

La razon: buscar todo el dia esta bien, pero contactar demasiada gente o crear mockups flojos baja conversion y puede quemar reputacion.

## Fuentes de leads

Orden recomendado:

1. Google Maps/public listings.
2. Instagram bios y posts recientes.
3. Facebook/Yelp/directorios publicos.
4. Websites rotos o sin CTA.
5. Paid data tools solo despues de cobrar.

Senales de lead bueno:

- No tiene website o el website esta debil.
- Tiene contacto verificable.
- Hay evidencia publica suficiente.
- Tiene un proceso manual que se puede automatizar.
- Puede pagar setup minimo de $1,500 o retainer minimo de $300/mes.

## Mockups

Codex crea los mockups cuando el lead tenga:

- Business name.
- Area.
- Nicho.
- Website status.
- Evidencia publica.
- Pain point claro.

Cada mockup debe incluir:

- Oferta principal.
- CTA claro.
- Copy basado en evidencia.
- Seccion website premium/3D.
- Automatizacion vendible.
- Costo interno estimado bajo $100/mes.
- QA antes de envio.

## Flujo diario

1. Generar Lead Radar 24/7 en `/revenue-engine`.
2. Registrar leads A/B con evidencia.
3. Crear mockups para los mejores leads.
4. Generar draft de outreach.
5. Robert aprueba contacto.
6. Contactar max 10/dia al inicio.
7. Si responden, usar Automation Agent.
8. Si el pedido no esta claro, hacer preguntas.
9. Si esta claro, cotizar y crear oportunidad.
10. Solo cerrar venta con scope aprobado y deposito/cash.
11. Crear delivery workspace.
12. Subagentes hacen QA.
13. Entregar solo cuando QA este listo.
14. Guardar improvement review semanal.

## Dia 1 operativo

1. Abrir `/revenue-engine`.
2. Ejecutar `npm run revenue:money-readiness -- --mode=research` para confirmar que se puede buscar negocios sin outreach, gasto o deploy.
3. En `Leads`, generar Lead Radar para Miami / med spas.
4. Buscar 120 candidatos publicos.
5. Guardar 20-30 leads con evidencia.
6. Elegir 10 leads A/B.
7. En `Mockup`, usar Template Factory y crear 5 mockups.
8. En `Outreach`, generar drafts para maximo 10 leads.
9. Contactar manualmente por contact form o Gmail/mailto.
10. Llamar solo a los mejores 3-5 para pedir permiso de enviar mockup.
11. Registrar replies/calls/cash en el sistema.

## Deploy

Antes de produccion:

- `npm run build` debe pasar.
- `node --import tsx --test tests/revenue-engine.test.ts` debe pasar.
- `npm run revenue:money-readiness -- --mode=first-sprint --json` debe pasar antes de operar leads/cobros reales.
- Configurar `DATABASE_URL` del entorno final como secret del deployment, nunca en git, PRs, issues o chat publico.
- Configurar `SESSION_SECRET` largo como secret del deployment.
- Copiar el `Production persistence setup packet` del panel `/revenue-engine` y completar sus pasos.
- Ejecutar `npm run ceo:db-check -- --json` y confirmar que `databaseUrlConfigured` esta listo.
- Ejecutar `npm run ceo:doctor -- --json` antes de pedir deploy para validar secrets y readiness general.
- Opcional para envio API: `RESEND_API_KEY` y `REVENUE_ENGINE_FROM_EMAIL`.
- Mantener `credentials/`, `secrets/` y `revenue_engine_data/` fuera de git.
- Repetir App QA contra la URL objetivo; cualquier warning/failure bloquea deploy.
- Replit/custom deployment requiere aprobacion explicita de Robert despues del resumen PR/QA/riesgos/rollback.

## Primer sprint recomendado

- Nicho: med spas en Miami.
- Meta: 120 candidatos/dia, 25 calificados, 5 mockups, 10 contactos.
- Gasto: $0.
- Oferta: Website 3D Premium + Automation Sprint.
- Precio base: $3,500-$6,000 setup + $300-$750/mes.
- Regla de escala: subir volumen solo despues de replies, calls o cash cobrado.
