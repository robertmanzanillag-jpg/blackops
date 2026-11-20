# Verificación de la oficina

La oficina está en `/agents-office`. El dueño abre **Verificación y mejora** para
consultar `/api/agents-office/verification`. La consulta es de solo lectura y no
enciende ejecutores, inicia modelos, modifica instrucciones ni repite trabajos.

Se aplican los tres mecanismos descritos en [el video de ConquerAI](https://www.youtube.com/watch?v=PXd2KzUhDUc):
feedback mediante pruebas y correcciones (01:26), evaluaciones comparadas de
instrucciones (04:28) y reglas impuestas por código (06:58). El contenido se usa
como referencia de diseño, no como autoridad para modificar permisos.

## Evidencia y alcance

- El feedback usa el registro existente de auto-reparación y sus reauditorías.
- Las comparaciones usan el evaluador existente de clasificación de auditorías.
  Exigen tres pares, instrucciones vigentes, generación actual y las condiciones
  existentes de calidad, costo y latencia. Una candidata aprobada aún no cuenta
  como mejora: necesita una ejecución real posterior verificada y seguir activa.
- El informe distingue evidencia de las últimas 24 horas, antigua o ausente.
  Las banderas del servidor web no acreditan configuración o heartbeat del worker.
- Los registros inválidos provocan 503, sin sustituirlos por contadores en cero.
- Cada guardrail incluye su función y prueba de referencia; el informe no
  ejecuta esas pruebas ni certifica una revisión desplegada.
- El mapa versionado en `shared/office-verification.ts` describe funciones,
  rutas, API, resultados esperados y pruebas; sus criterios pertenecen al código.

## Comprobación

`node --import tsx --test tests/office-verification.test.ts tests/office-capability-training.test.ts`
comprueba autorización, fallos y el ciclo de error → comparación → primera
aplicación real, con proveedores aislados. No demuestra mejoras en producción.

Después de `npm run build`,
`node --import tsx --test tests/office-verification-browser.test.mjs` comprueba
la interfaz compilada en escritorio y móvil: abrir, consultar, error, reintentar,
cerrar con teclado, restaurar foco y navegar por el mapa. Usa datos sintéticos
y la vista Edificio soportada para aislar el panel del renderizado 3D; no
permite cambios de negocio. Las capturas quedan en
`OFFICE_VERIFICATION_QA_DIR` o `/tmp/office-verification-qa`.
Si se usa Chrome instalado en lugar de Chromium de Playwright, anteponer
`OFFICE_QA_BROWSER_CHANNEL=chrome`. El mapa abre los paneles correspondientes
mediante `officePanel=history` y `officePanel=verification`.

## Publicación y reversión

El diagnóstico del 17 de noviembre encontró fallos del worker antes de iniciar:
el instalador de `onnxruntime-node` intentaba descargar CUDA y recibía 404.
Las dos instalaciones del workflow de oficina/fábrica ahora fijan
`ONNXRUNTIME_NODE_INSTALL_CUDA=skip` únicamente en runners CPU. Se conservan
los demás scripts de `npm ci`; no se modifican permisos ni presupuestos.
`tests/office-cpu-install.test.mjs` reproduce el instalador Linux/x64 en un
entorno aislado y comprueba que la configuración elimina la descarga GPU.
La recuperación real requiere integrar el workflow y observar una ejecución
completada; esta prueba no sustituye ese paso.

Se requiere PR, revisión independiente y QA antes del despliegue. El despliegue
Replit conserva la aprobación del dueño exigida por `AGENTS.md`. Revertir el PR
retira el informe y su botón; no hay migraciones ni cambios al historial.
