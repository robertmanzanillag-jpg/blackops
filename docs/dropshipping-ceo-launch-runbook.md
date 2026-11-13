# Dropshipping CEO launch runbook

Estado: listo en modo pre-cuentas. No hay gasto, publicacion externa, compra de inventario ni contacto real a proveedor hasta conectar cuentas.

## Decision del modelo

El negocio debe arrancar como dropshipping puro: la tienda recibe la orden, cobra al cliente y luego se prepara fulfillment con proveedor por orden pagada. No se compra stock mayorista. El inventario propio queda prohibido hasta que haya ventas repetibles, profit positivo y riesgo de devoluciones controlado.

Fuentes de guardrail:

- Shopify mantiene dropshipping como modelo de bajo overhead, pero recomienda proveedores confiables, muestras, reglas simples de shipping, seguridad, soporte y marketing.
- Shopify lista `Pet supplies` como categoria activa y `Pet water bottles` dentro de productos de pet supplies para dropshipping 2026.
- FTC Mail, Internet, or Telephone Order Rule exige base razonable para promesas de envio; si no se promete fecha, se debe tener base razonable para enviar en 30 dias, y si hay delay se debe pedir consentimiento o reembolsar.
- TikTok Creative Center enfatiza analizar Top Ads, Trends y triggers creativos para entender que impulsa engagement y conversion.

URLs de referencia:

- https://www.shopify.com/blog/dropshipping-tips
- https://www.shopify.com/blog/best-dropshipping-products
- https://www.ftc.gov/business-guidance/resources/business-guide-ftcs-mail-internet-or-telephone-order-merchandise-rule
- https://ads.tiktok.com/business/creativecenter/

## Producto foco

Producto: Pet water bottle for walks.

Por que este:

- Problema visual y simple: perro con sed durante caminata/parque/viaje corto.
- Bajo riesgo legal si el copy evita claims medicos y promesas absolutas.
- Buen angulo para video corto: antes/despues, rutina de paseo, demo de uso.
- Categoria pet supplies con demanda y oportunidad de repeticion/bundles.

Economia base:

- Costo producto: $4.50.
- Shipping estimado: $3.50.
- Landed cost: $8.00.
- Precio objetivo: $21.99.
- Profit bruto por orden: $13.99.
- Margen bruto: 64%.
- Revenue objetivo mensual: $1,000.
- Ordenes necesarias para $1,000 revenue: 46.
- Break-even contra budget $100: 8 ordenes.

Oferta inicial:

- Headline: Portable dog water bottle for walks, parks, and short trips.
- Promesa permitida: makes it easier to offer water during walks without carrying a separate bowl.
- Precio inicial: $21.99.
- Oferta de validacion: clear shipping estimate, simple return policy, no exaggerated claims.
- Bundle futuro: 2-pack o add-on poop bags/leash accessory solo despues de primeras ventas.

## Budget y Profit Guard

Budget inicial: $100.

Reglas:

- $0 ads hasta que tienda/listing, politicas y tracking esten listos.
- $0 inventario.
- Cap diario inicial: $10.
- Sample opcional de 1 unidad despues de conectar cuenta/proveedor, maximo $8-$15, solo para validar calidad y crear contenido real.
- Micro ads max $10 por test solo si hay approval, cash disponible y senal organica.
- Nunca gastar mas de lo cobrado sin decision nueva.
- Pausar ads si el gasto llega a 50% del tramo sin add-to-cart o venta.
- Pausar producto si hay refunds, promesa de shipping rota o supplier sin tracking confiable.

## Estado pre-cuentas

Completado en app:

- Dropshipping CEO engine.
- Product Scout con shortlist.
- Producto foco promovido.
- Launch pack draft.
- Shopify preflight/draft payload local.
- Campaign draft.
- Social posts draft.
- Capital plan con budget protegido.
- Growth Board.
- Launch readiness gate con Postgres, checkout, producto/supplier y automatizacion.
- Daily report preview.
- Approval outbox local cuando Postgres/Trust Center no esta encendido.
- Politicas publicas draft:
  - `/dropshipping/legal/privacy`
  - `/dropshipping/legal/refund-policy`
  - `/dropshipping/legal/shipping-policy`
  - `/dropshipping/legal/terms`
  - `/dropshipping/legal/checkout-readiness`
  - `/api/dropshipping-ceo/launch-readiness`
  - `/api/dropshipping-ceo/approval-outbox-migration`

Bloqueado hasta cuentas:

- Crear producto real en Shopify.
- Publicar posts reales.
- Enviar reportes reales por Telegram.
- Activar ads o pixels.
- Contactar proveedor por cuenta real.
- Comprar sample.
- Fulfill de orden real.

## Subagentes

Dropshipping CEO:

- Decide producto foco, presupuesto y siguiente sprint.
- Mantiene meta $1k/mes.
- No ejecuta acciones externas sin guardrails.

Product Scout:

- Busca candidatos baratos, ligeros, demostrables y con margen.
- Compara alternativas contra producto foco.

Supplier Analyst:

- Verifica rating, reviews, tracking, returns, stock y proveedor backup.
- Bloquea escala si shipping o quality risk no estan claros.

Store Builder:

- Prepara Shopify draft, copy, FAQ y politicas.
- No publica producto sin cuenta y approval.

Marketing CMO:

- Produce hooks, captions y calendario organico.
- Aprende con views, clicks, add-to-carts, ventas y comentarios.

Ads Strategist:

- Solo prepara micro tests.
- No gasta sin Profit Guard, cap diario y approval.

Learning Analyst:

- Decide kill, iterate o scale.
- Actualiza playbook diario.

Legal + Security:

- Bloquea marcas ajenas, claims exagerados, promesas de envio no verificadas y assets sin permiso.
- Mantiene policy routes y checkout readiness antes de publicar.

Order Ops:

- Maneja fulfillment por orden pagada.
- No compra inventario ni procesa supplier order sin pago confirmado.

## Marketing inicial

Canales:

- TikTok.
- Instagram Reels.
- YouTube Shorts.
- Pinterest.

Primeros hooks:

- The tiny bottle I wish I had on every dog walk.
- Stop carrying a separate bowl for quick walks.
- Park walk test: can this make dog water breaks easier?
- What I check before selling a pet product online.
- Honest dropshipping test: price, shipping, and product demo.
- Dog walk essentials under $25.

Calendario organico 7 dias:

1. Demo problema/solucion, sin vender fuerte.
2. Antes/despues de paseo con botella.
3. Precio + shipping honesto + por que estamos validando.
4. Pregunta a audiencia: would you use this on walks?
5. Comparacion contra bowl separado.
6. Quality checklist y sample requirement.
7. Recap: views, clicks, preguntas y decision de iterar.

Metricas diarias:

- Posts drafted.
- Posts published.
- Views.
- Clicks.
- Add-to-carts.
- Orders.
- Revenue.
- Spend.
- Refunds.
- Profit.
- Comentarios/objeciones.

Reglas de decision:

- Views altos, clicks bajos: cambiar hook/CTA.
- Clicks altos, add-to-cart bajo: mejorar precio, imagenes, landing o trust.
- Add-to-cart alto, ordenes bajas: revisar checkout, shipping, pagos y garantia.
- Ordenes con profit: preparar micro test.
- Refunds o quejas: pausar y corregir supplier/copy.

## Tienda y politicas

Antes de vender:

- Nombre de marca.
- Email de soporte.
- Politicas reales con dominio final.
- Shipping estimate visible: usar rango conservador y no prometer mas rapido que el proveedor.
- Refund/return policy visible antes de checkout.
- Privacy/terms visibles.
- Imagenes o video con permiso.
- FAQ de shipping, tracking, returns y soporte.
- Tracking/pixel configurado.

Copy permitido:

- Portable.
- Easy to carry.
- Useful for walks, parks, short trips.
- Estimated shipping.
- Draft/validation language mientras se prueba.

Copy bloqueado:

- Claims medicos o de salud.
- Garantias absolutas.
- Marcas ajenas.
- Promesas de delivery no verificadas.
- "Best", "official", "guaranteed" sin evidencia.

## Plan de manana

Cuando se conecten cuentas, hacer solo esto:

1. Conectar Shopify y confirmar que el producto queda como DRAFT.
2. Conectar Telegram y enviar reporte test.
3. Conectar social publisher o definir modo manual.
4. Conectar proveedor/DSers/AliExpress y revisar sample de 1 unidad.
5. Encender Postgres/Trust Center, usar Approvals > Migrar outbox local, primero en dry-run y luego ejecutar.
6. Confirmar politicas con URLs reales.
7. Publicar primer contenido organico si Robert aprueba.
8. Mantener ads en $0 hasta tener tracking y primera senal.

## Definition of ready

El sistema esta ready pre-cuentas cuando:

- `npm run build` pasa.
- Tests de Dropshipping CEO pasan.
- Tests de Marketing Command Center pasan.
- Producto foco, campaign y posts estan preparados localmente.
- Approval outbox existe para acciones pendientes.
- No se requiere stock.
- Lo unico pendiente es conectar cuentas y aprobar acciones externas.
