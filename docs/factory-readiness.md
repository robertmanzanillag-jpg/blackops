# Preparación de la fábrica: qué significa cada bloqueo

Estado de producción observado (11-11-2026): `readiness: "blocked"` con dos bloqueos globales y, para
el proyecto `asistente`, `project_commands_missing`, `isolated_environment_missing` y
`provider_release_or_recovery_unavailable`.

Conclusión corta: **los cinco avisos miden la publicación automática, no el modo propuestas**. La
fábrica de Asistente funciona por diseño en modo `review-only` (construye, prueba en GitHub Actions,
revisa y deja un PR; nunca despliega). En ese modo dos de los bloqueos son imposibles de cumplir a
propósito, y el entorno aislado de pruebas ya existe: `.github/workflows/factory-candidate-checks.yml`.

## Dónde se calcula

| Aviso | Código | Condición exacta |
|---|---|---|
| "Faltan ejecutores configurados para completar todas las etapas." | `server/software-factory-routes.ts` (GET `/api/software-factory`) | Algún worker con latido de ≤45 s debe declarar `true` en **las 8 etapas**: discover, build, simulate, review, **deploy, verify, rollback, evaluate**. |
| "La publicación automática requiere ensayos y recuperación verificados…" | mismo archivo | Un proyecto con `projectReadiness` completo **y** `automaticRelease=true`, 3 ensayos y prueba de recuperación de menos de 24 h. |
| `project_commands_missing` | `server/software-factory.ts` `projectReadiness` | `testCommand`, `buildCommand` **y** `rollbackCommand` no vacíos en la fila `software_factory_projects.config`. (El modo propuestas, `proposalReadiness`, solo exige test y build). |
| `isolated_environment_missing` | igual | `stagingUrl`, `productionUrl`, `healthUrl` URL http(s) válidas y `stagingUrl ≠ productionUrl`. Es el **destino de despliegue**, no el lugar donde se prueban los cambios. |
| `provider_release_or_recovery_unavailable` | igual | `providerSupportsRelease` y `providerSupportsRollback` en `true`. Solo los cambia `store.configureProjectExecution` (código del operador; no hay ruta HTTP y el registro desde el panel los fuerza a `false`). |

En modo `review-only` el worker publica `deploy/verify/rollback/evaluate = false`
(`server/software-factory-worker.ts`, función `capabilities`). Además el operador de Asistente **se
niega a arrancar** si el proyecto tiene `automaticRelease`, `providerSupportsRelease` o
`providerSupportsRollback` en `true` (`software-factory-asistente-operator.ts`, y también la
recuperación de builds). Activarlos rompería la fábrica actual.

## Tabla: bloqueo → qué lo satisface → quién → opción segura en la nube

| Bloqueo | Qué lo satisface | Quién | Opción segura recomendada |
|---|---|---|---|
| Ejecutores de las 8 etapas | Adaptadores reales de despliegue, verificación, rollback y evaluación | Código nuevo + aprobación de Robert (publicación) | **No activar.** Usar el nuevo bloque `proposal` del panel, que mide solo discover/build/simulate/review. |
| Publicación automática verificada | 3 ensayos + recuperación < 24 h + `automaticRelease` | Operador, tras tener staging real | **Mantener bloqueado** (política: la fábrica es solo revisión). |
| `project_commands_missing` | Registrar comandos en el proyecto `asistente` | **Robert** (panel → "Registrar o actualizar una aplicación") | Ver valores abajo. Para el modo propuestas basta test + build; el de recuperación es manual. |
| `isolated_environment_missing` (destino) | URLs reales de staging/producción/salud distintas | **Robert**, solo cuando exista un staging real | No inventar un staging. El aislamiento de **pruebas** ya lo cubre GitHub Actions (ver abajo). |
| `provider_release_or_recovery_unavailable` | Proveedor de despliegue con rollback verificable | Código de operador + aprobación | **Mantener en `false`**: el operador de Asistente lo exige. |

## Entorno aislado de pruebas que ya existe (GitHub-hosted)

`factory-candidate-checks.yml` se dispara con cada push a `factory/**`, que es la rama que crea el
build de la fábrica. En un runner `ubuntu-24.04` limpio por ejecución:

- exporta el commit exacto sin `.git`, `.env`, claves, `credentials/` ni `secrets/`;
- `npm ci --ignore-scripts` dentro de Docker (imagen node fijada por digest);
- pruebas y `npm run build` en Docker con `--network none --read-only --cap-drop ALL`,
  `no-new-privileges`, límites de memoria/CPU/PIDs;
- pruebas de navegador (Playwright fijado por digest), aceptación del backend y regresión de UI
  comparando base y candidato.

`software-factory-actions.ts` solo acepta ese run si el SHA-256 del workflow coincide con el fijado
en la configuración del operador, el run es el único para ese commit, `run_attempt=1`, etiquetas de
runner GitHub-hosted y los tres pasos terminaron en `success`. No hace falta otro ejecutor: duplicarlo
añadiría superficie sin aportar aislamiento.

## Valores sugeridos para registrar `asistente`

Registrar con el mismo id y conservar exactamente los dos recorridos (si no, el operador falla):

- Repositorio: `robertmanzanillag-jpg/blackops`
- Comando de pruebas: `node --import tsx --test tests/office-role-work.test.ts`
  (referencia; las pruebas reales que cuentan son las del workflow aislado)
- Comando de construcción: `npm run build`
- Comando de recuperación: `manual: revertir el PR en GitHub; sin despliegue automático`
- Recorridos: `office-session-login` y `office-company-navigation`
- URLs: las reales de producción/salud y un staging solo si existe. El formulario exige URLs válidas
  y distintas; no uses un staging ficticio.

Guardar desde el panel pone siempre `automaticRelease`, `providerSupports*` y ensayos en vacío, así
que no habilita publicación.

## Por qué fallaron los 3 builds: lista de comprobación

El panel ahora muestra el **código** del resultado de cada trabajo (solo códigos internos
`FACTORY_*` o razones de la puerta en snake_case; nunca texto libre). Con él:

| Código | Causa probable | Acción |
|---|---|---|
| `FACTORY_REMOTE_PREFLIGHT_BLOCKED` | La rama base avanzó desde el descubrimiento, o `checks.workflowSha256` del operador ya no coincide con el workflow en la base | Actualizar el `baseSha` de la orden y los hashes. En `b7884f3` el SHA-256 de `factory-candidate-checks.yml` es `958439df0ee18d6c2539ce0056baa9bad70b69b60abedcdbeabe933e0d06bd2d` (`checks.workflowSha256` y `ui.workflowSha256` deben ser iguales). Cada cambio del workflow cambia el hash. |
| `FACTORY_EXECUTION_UNCONFIRMED` / `FACTORY_REMOTE_CHECK_UNCONFIRMED` (estado unknown) | No apareció un run del workflow, o tardó más que el sondeo (40 × 15 s ≈ 10 min) | Comprobar que `SOFTWARE_FACTORY_GITHUB_TOKEN` es un PAT/App token: los pushes hechos con el `GITHUB_TOKEN` de Actions **no disparan** otros workflows. Revisar la duración real del run en la pestaña Actions. |
| `FACTORY_ACTIONS_CHECK_FAILED` | Las pruebas/build del candidato fallaron en el runner | Es un rechazo correcto; revisar el run. |
| `FACTORY_REMOTE_BUILD_FAILED:<diagnóstico>` | El modelo no produjo un parche válido (`PROVIDER_OUTPUT_LIMIT`, `MALFORMED_JSON`…) | Ver `docs/factory-build-recovery.md`. |
| `project_commands_missing,…` | El proyecto no pasa `proposalReadiness` | Registrar comandos (arriba). |

## Programación en la nube

`software-factory-cloud.yml` (en `main`) ejecuta `script/software-factory-once.ts` cada 2 h en un
runner limpio, en modo `review-only` y `company-orders-only`. Robert debe:

1. Crear los secretos y variables de `docs/factory-cloud.md` (rama `main`). El token de GitHub debe
   ser un fine-grained PAT (o GitHub App) limitado a este repositorio con Contents y Pull requests en
   escritura y Actions en lectura.
2. Comprobar que `FACTORY_DATABASE_URL` acepta conexiones desde fuera de Replit.
3. Revisar los hashes y `orders[].baseSha` de `SOFTWARE_FACTORY_OPERATOR_CONFIG_JSON` contra la base
   actual.

Entre ejecuciones no hay latido, así que ambos bloques mostrarán "No hay señal reciente del ejecutor"
salvo durante una ejecución, o si sigue activo el worker de Windows. Es lo esperado y no bloquea el
siguiente run programado.

## Qué no cambia

Ninguna puerta de publicación se relaja: `readiness`/`blockers` globales siguen idénticos y la
publicación automática sigue bloqueada. No hay despliegue, merge, secretos nuevos ni servicios de pago.
