# Área Clippers de la oficina

El botón **Área Clippers** abre un estudio propio desde las tres vistas de `/agents-office`. Su montaje está limitado al propietario. Antes de consultar datos, la sesión del router debe coincidir con una verificación nueva de `/api/auth/me`. Las respuestas privadas se separan por identidad y se descartan al desmontar; un error oculta los datos anteriores.

La vista consume exclusivamente `GET /api/clippers/orchestra/status`, con el parser estricto compartido. No ejecuta agentes, concede derechos, publica ni modifica configuración. Refresca mientras el área permanece abierta. Las fechas de la evidencia y los vencimientos del ejecutor se comprueban también en el navegador; un snapshot que envejece no conserva una etiqueta de ejecución actual.

`shared/clippers-office-agents.ts` define nueve roles del pipeline existente. Las responsabilidades del catálogo no son evidencia de actividad. Vida, generación, academia, habilidades y puntos se muestran solo cuando el backend entrega una carrera registrada. Un rol registrado sin resultados se identifica como vida inicial, no rendimiento. El backend es responsable de reconciliar estas carreras con los resultados fechados del ejecutor; la UI nunca asigna puntos ni recompensa un latido o una ejecución vacía.

Las pestañas incluyen cuentas y métricas por edad real, los ocho canales verificados de descubrimiento, crecimiento pareado frente a primera observación, y comparaciones de políticas/render receipts con requisitos de muestras, versiones y revisión manual. Desconexión, información ausente y cero observado son estados distintos. NY sin redes se presenta como destino bloqueado; no se inventa una red. KONG y Black Room permanecen excluidos.

## Verificación local

Con las dependencias ya instaladas, ejecutar:

```sh
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/vite/bin/vite.js build
node --test tests/clippers-office-area.test.mjs
```

El navegador usa el componente y CSS reales con un servidor local y datos sintéticos. Cubre escritorio/móvil, nueve roles, vida registrada frente a carrera ausente, expiración de ejecución y transporte, derechos separados, métricas ausentes, error que oculta el snapshot y cambio de identidad que impide lecturas privadas. Los requests de la vista deben ser solamente GET. `OFFICE_VERIFICATION_QA_DIR` permite conservar screenshots de fixture para revisión independiente; no son capturas de producción.

La entrega requiere integración con el backend de la orquesta, revisión independiente, App QA y CI. No consta una publicación ni una mejora real de rendimiento por añadir esta interfaz. Rollback: retirar el montaje y el componente; conservar reportes, carreras, políticas y evidencias existentes.
