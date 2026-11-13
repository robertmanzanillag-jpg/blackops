# Dropshipping checkout and Trust Center runbook

Estado: pre-cuentas. Este documento deja listo lo que se puede preparar antes de conectar Shopify, pagos, Telegram, redes o proveedor.

## Que se puede cerrar antes de cuentas

- Politicas draft: privacy, refund, shipping, terms.
- Checklist de checkout.
- Reglas de shipping y delay handling.
- Approval outbox local.
- Migrador de outbox local a Trust Center.
- Launch readiness panel en Dropshipping CEO > Execution.
- Budget guardrails por defecto: `$100` mensual, `$10` diario, approvals obligatorios y sample antes de escalar.
- Tests y build.

## Que requiere cuentas

- Probar checkout real.
- Probar payment processor real o test mode de Shopify/Stripe.
- Confirmar tax/shipping en checkout.
- Crear producto real como Shopify DRAFT.
- Enviar reportes por Telegram.
- Publicar posts reales.
- Validar proveedor con cuenta real.

## Politicas publicas draft

Rutas disponibles:

- `/dropshipping/legal/privacy`
- `/dropshipping/legal/refund-policy`
- `/dropshipping/legal/shipping-policy`
- `/dropshipping/legal/terms`
- `/dropshipping/legal/checkout-readiness`

Estas rutas son drafts operativos. Antes de publicarlas en la tienda real hay que reemplazar:

- Store name.
- Legal entity, si aplica.
- Support email.
- Business address, si aplica.
- Payment processor.
- Shipping ranges reales por producto.
- Return window final.
- Supplier-specific restrictions.
- Jurisdiction/tax language.

## Shipping guardrail

Regla base:

- No prometer delivery exacto sin evidencia del proveedor.
- Mostrar rangos estimados y claros.
- Mantener evidencia de proveedor, tracking, stock y tiempos.
- Si no se puede cumplir el tiempo prometido, enviar delay notice, nueva fecha si existe, opcion de cancelar y refund cuando aplique.

Referencia principal:

- FTC Mail, Internet, or Telephone Order Merchandise Rule: se necesita base razonable para prometer envio; si no hay promesa clara, se requiere base razonable para enviar dentro de 30 dias; si hay delay, se debe pedir consentimiento o reembolsar cuando corresponda.

## Checkout checklist

Antes de activar ventas:

- Producto en Shopify DRAFT revisado.
- Product page con precio, fotos/video permitidos, shipping estimate, returns/refund, privacy, terms, support contact.
- No claims medicos, garantias absolutas ni marcas ajenas.
- Payment processor en test mode o live mode confirmado.
- Tax/shipping visible antes de pagar.
- Order confirmation email revisado.
- Refund/cancel path probado.
- Supplier primary y backup documentados.
- Tracking path conocido.
- Fulfillment de primera orden sigue approval-required.

## Trust Center / Postgres

Estado local actual:

- El sistema puede guardar approvals en `dropshipping_engine_data/approval_outbox.json` cuando Postgres no responde.
- El panel Dropshipping CEO > Execution > Launch readiness marca Postgres como `needs_database` hasta configurar `DATABASE_URL`.
- El nuevo endpoint `/api/dropshipping-ceo/approval-outbox-migration` permite:
  - `dryRun: true`: revisar que se migraria.
  - `dryRun: false`: crear pending approvals en Trust Center y marcar items como `queued_in_trust_center`.

El endpoint no ejecuta acciones externas. Solo crea approvals.

## Requisitos para migrar outbox

1. Configurar `DATABASE_URL`.
   - En Replit, usa la herramienta Database/Postgres del proyecto. Replit genera el connection string y lo guarda/expone como secret `DATABASE_URL`.
2. Aplicar schema:
   `npm run db:push`
3. Confirmar DB:
   `npm run ceo:db-check -- --json`
4. Abrir Dropshipping CEO > Approvals > Migrar outbox local.
5. Primero usar `Revisar`.
6. Luego usar `Migrar`.

Si Postgres sigue apagado, la migracion falla sin borrar el outbox local.

## Budget y automatizacion

Defaults versionados en `CEO_ASSISTANT_ENV.example`:

- `DROPSHIPPING_STARTING_MONTHLY_BUDGET_USD=100`
- `DROPSHIPPING_TARGET_MONTHLY_REVENUE_USD=1000`
- `DROPSHIPPING_DAILY_SPEND_CAP_USD=10`
- `DROPSHIPPING_REQUIRE_APPROVALS_FOR_EXTERNAL_ACTIONS=true`
- `DROPSHIPPING_REQUIRE_SAMPLE_BEFORE_SCALE=true`

Con estos defaults, el CEO puede crear research, drafts, posts y reports. No puede gastar, publicar, comprar sample, fulfill ni contactar externamente sin approval y cuenta conectada.

## Social publisher

- Si hay un webhook propio compatible, configurar `DROPSHIPPING_SOCIAL_PUBLISH_WEBHOOK_URL`.
- Si ya existe Metricool (`METRICOOL_USER_TOKEN` + `METRICOOL_USER_ID`), Dropshipping CEO lo reconoce como puente social listo para preparar cola/aprobacion.
- Metricool no elimina el approval gate: el primer publish real sigue requiriendo approval y evidencia de URL publicada o un wrapper webhook probado.

## Policy URLs

Cuando `PUBLIC_APP_URL` esta configurado, Dropshipping CEO usa automaticamente las rutas publicas locales de privacy/refund/shipping/terms/checkout-readiness. `DROPSHIPPING_RETURN_POLICY_URL` y `DROPSHIPPING_PRIVACY_POLICY_URL` quedan como overrides opcionales para URLs finales de Shopify.

## Comandos de validacion

```bash
npm run build
node --import tsx --test --test-reporter=dot tests/dropshipping-ceo.test.ts
node --import tsx --test --test-reporter=dot tests/marketing-command-center.test.ts
```

En esta PC, si `node` no esta en PATH, usar el runtime bundled de Codex o ejecutar desde la app.
