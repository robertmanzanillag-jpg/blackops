> **13 nov 2026:** `claude/integration-20261111` se unió a `main`. Desde entonces `main` es la única rama de producción.

# Release gate y sandbox (BlackOps / Daily Planner)

Resumen para Robert: **nada se publica en Replit sin pasar antes por un sandbox y por un control
"super exigente"**. Si algo se rompe después de publicar, una vigilancia horaria lo detecta, abre
un issue `regression` y el arreglo vuelve a pasar por todo el proceso.

## El proceso completo

```
cambio (PR) ──> sandbox ──> gate exigente ──> revisión independiente ──> merge
     ▲                                                                   │
     │                                                                   ▼
 PR de arreglo                                   script/replit-sync-from-github.sh
     ▲                                                                   │
     │                                                                   ▼
 issue `regression` <── vigilancia post-publicación (cada hora) <── republicar en Replit
```

1. **PR**: todo cambio va en una rama y un PR hacia `main` (la rama de
   producción). Nunca directo.
2. **Sandbox** (automático, workflow `Sandbox release gate`, job `sandbox`): en una máquina limpia
   de GitHub se crea una base PostgreSQL **efímera** (nunca Neon/producción), se aplica el esquema
   (`drizzle-kit push`) y las migraciones explícitas (`office-cloud-migrate`,
   `software-factory-migrate`, `office-source-documents-migrate`: simulación, aplicación y una
   segunda aplicación para probar que son repetibles), se crea un usuario dueño de prueba, se
   compila (`npm run build`) y se arranca la app en modo producción con
   `script/replit-fast-start.mjs` (igual que Replit) **sin ninguna clave real**. Después corre la
   batería de humo `script/release-gate/smoke.mjs`:
   - `/api/health` con el contrato completo (status, ready, officeProtocol, officeSources...).
   - Frontera de autenticación (anónimo recibe 401; la sesión firmada de prueba funciona).
   - ~30 rutas API de solo lectura con usuario autenticado: ninguna puede devolver 5xx.
   - Páginas clave en un navegador real (Chromium): `/`, `/dashboard`, `/agents-office`, `/ceo`,
     `/projects`, `/automations`, `/tools`, `/app-qa-agent`, `/marketing-command-center`, `/news`.
     Sin excepciones JavaScript, sin 5xx del propio servidor; **la oficina de agentes debe
     renderizar con cero errores de consola**.
   - Login real con usuario y contraseña (sesión guardada en PostgreSQL, como en producción).
   - Al final se comprueba que el servidor sigue vivo y que su log no tiene firmas de caída.
   - **Guardia de esquema**: después de todo, `drizzle-kit push` contra la base efímera debe
     responder "No changes detected": ningún `DROP`, cambio de tipo o pérdida de datos, y ningún
     cambio pendiente que las migraciones no hayan hecho. Esta guardia encontró que `npm run db:push` habría
     borrado las tablas de la oficina, la fábrica y las sesiones; `drizzle.config.ts` ahora las
     excluye con `tablesFilter`.
   Se sube un artefacto `release-gate-sandbox` (smoke.json, capturas, log de arranque y build).
3. **Gate exigente** (mismo workflow, jobs en paralelo):
   - `typecheck`: `tsc --noEmit` completo (8 GB de memoria).
   - `tests`: **todos** los `tests/*.test.ts|mjs`, cada archivo en su propio proceso con límite de
     tiempo y entorno sin secretos. Se comparan **los nombres de cada test que falla** (no solo el
     archivo) con `script/release-gate/known-failures.json`: solo se toleran los tests exactos
     listados en `failing` de cada entrada (cada una con su motivo). Un test nuevo que falla bloquea,
     aunque esté en un archivo ya tolerado. Un test tolerado que empieza a pasar también bloquea
     hasta que se borra de la lista (así la lista solo puede encogerse). La lista de tests de la
     fábrica (leída directamente de `factory-candidate-checks.yml` y
     `factory-build-recovery-checks.yml`, incluido `tests/marketing-learning-ui.mjs`) debe estar
     100% en verde y nunca se puede poner en la lista de tolerados; si esos workflows faltan o no
     nombran tests, el gate falla.
   - `import-check`: cada archivo cambiado de `server/`, `shared/` y `client/` debe seguir
     cargando (los de servidor se importan de verdad; los de cliente se empaquetan con esbuild).
   - `hygiene`: higiene del diff sin imprimir nunca el contenido encontrado: patrones de secretos
     (claves privadas, tokens de GitHub/Stripe/Slack/Google/Telegram, URLs de base de datos con
     contraseña), archivos `.env`, claves, `credentials/`, `secrets/`, `node_modules/`, archivos
     `._*` de macOS, marcadores de conflicto, `test.only`, archivos de más de 2 MB y cualquier
     cambio a `factory-candidate-checks.yml` (su SHA está fijado por la configuración del operador
     de la fábrica). Cambios a `.replit`, `replit.nix`, `package.json`, `package-lock.json`, a la
     maquinaria del gate, a `.github/CODEOWNERS` o entradas **nuevas o modificadas** en la lista de
     tolerados (por ejemplo marcar `flaky` o ampliar códigos) exigen la etiqueta `gate-justified`
     (decisión del dueño, con la justificación en el PR); quitar entradas o nombres arreglados no.
     La higiene se ejecuta con la copia del script de la **rama base**, para que un PR no pueda
     debilitar el control que lo juzga. Además valida YAML y ejecuta `actionlint`.
   - `release-gate`: **un único check resumen**. Es el que hay que marcar como obligatorio.
     Escribe el informe en el resumen del run y en el artefacto `release-gate-report`.
   En PRs hacia `main` (solo workflows) corre únicamente `hygiene` + `actionlint`.
4. **Revisión independiente** (segundo revisor, opcional): Actions → `Office PR review (manual,
   second reviewer)` → Run workflow → número del PR. Con `apply=false` solo comprueba la cola (solo
   lectura); con `apply=true` encola una revisión `claude_review` de la oficina para ese PR. El SHA
   del head en el momento del envío solo sirve como clave de idempotencia (repetir para el mismo
   head no duplica): el revisor lee el head que tenga el PR cuando corre, así que **hay que comparar
   el `review.headSha` del veredicto con el commit que se va a mergear**; si no coincide, el
   veredicto no vale para ese commit y hay que lanzarlo otra vez. El código que toca la base sale de la rama de
   producción, no del PR. El veredicto aparece en la Agents Office. Además sigue vigente la regla
   de AGENTS.md: un segundo agente revisa el diff (`/review-pr`).
5. **Merge** del PR solo con `release-gate` en verde. El mismo workflow vuelve a correr sobre la
   rama de producción tras el merge (evento `push`): ese run verde es la señal para publicar.
6. **Sincronizar Replit**: en el Shell de Replit, `script/replit-sync-from-github.sh` (ver su
   cabecera) y **republicar** con aprobación explícita de Robert.
7. **Vigilancia post-publicación** (`Post-publish watch`, cada hora en el minuto 41, desde `main`):
   diagnóstico de solo lectura (`script/office-status.ts`, transacción READ ONLY) + los últimos
   runs del worker de oficina. Códigos:
   `OFFICE_RUNS_FAILING` (3+ runs seguidos fallidos), `OFFICE_STATUS_UNAVAILABLE`,
   `COUNCIL_STATE_MISSING`, `ROLE_WORK_INVALID`, `CAPABILITY_TRAINING_INVALID`,
   `OFFICE_WORKER_SILENT` (sin worker de nube > 1 h, solo si la oficina en la nube está activa),
   `WEB_EXPORT_MISSING` / `WEB_EXPORT_STALE` (export de la web ausente o > 1 h, solo si las
   fuentes web están activas).
8. **Si hay regresión**: se abre (o actualiza) **un** issue con la etiqueta `regression` y los
   códigos (sin secretos ni datos privados). Se vuelve al paso 1: PR de arreglo → gate → merge →
   sync → republicar. Cuando la vigilancia vuelve a estar limpia lo comenta en el issue; el issue se
   cierra al publicar el arreglo.

## Ejecutar el sandbox a mano

Actions → `Sandbox release gate` → Run workflow → `ref` (rama, tag o SHA). Útil para probar una
rama antes de abrir el PR o para repetir la verificación de producción.

## Mantener la lista de fallos conocidos

`script/release-gate/known-failures.json`:

- `knownFailures`: `"tests/archivo.test.ts": { "reason": "...", "failing": ["nombre del test", ...],
  "flaky": false, "timeoutMs": 120000 }`. `failing` son los nombres exactos (subtests como
  `padre > hijo`; `<timeout>` si se cuelga). `flaky: true` tolera que esos tests a veces pasen,
  pero un nombre nuevo sigue bloqueando; `timeoutMs` acorta el límite de un test que se cuelga.
  Hoy hay 16 entradas (2 marcadas `flaky`, por eso un run puede mostrar 14-16 fallos conocidos): casi todas son tests del toolchain del Mac del operador (LaunchAgent, zsh,
  ImageMagick, `/private/tmp`) o fallos ya existentes; ver el motivo de cada una. Arreglar un test
  = borrar su nombre (o la entrada) en el mismo PR (no necesita etiqueta). Añadir o cambiar una
  entrada necesita la etiqueta `gate-justified` y una explicación.
- `sandboxIntegrationRoutes`: ruta + código exacto que el sandbox tolera porque allí no existen
  los conectores de Replit ni el acceso a KONG. Cualquier otro 5xx falla.

## Lo que el dueño debe activar (una vez)

1. Settings → Branches → Add branch ruleset (o "Add classic branch protection rule") para
   `main`:
   - Require a pull request before merging.
   - Require status checks to pass → buscar y añadir **`release-gate`** (aparece después del
     primer run). Marcar también "Require branches to be up to date before merging".
   - Require review from Code Owners (activa `.github/CODEOWNERS`: los cambios a workflows y a
     `script/release-gate/` necesitan la aprobación de Robert).
   - (Recomendado) Do not allow bypassing the above settings.
2. Lo mismo para `main` con el check `release-gate`.
3. Crear la etiqueta `gate-justified` (Issues → Labels → New label) para las excepciones
   justificadas. La etiqueta `regression` la crea la vigilancia sola.
4. Pausar la vigilancia si hiciera falta: variable de repositorio
   `POST_PUBLISH_WATCH_ENABLED=false`.

## Archivos

| Archivo | Rama | Qué hace |
| --- | --- | --- |
| `.github/workflows/sandbox-gate.yml` | main **y** producción (copias idénticas) | sandbox + gate + `release-gate` |
| `.github/workflows/office-pr-review.yml` | main | revisión independiente manual |
| `.github/workflows/post-publish-watch.yml` | main | vigilancia horaria + issue `regression` |
| `script/release-gate/*` | main y producción (copias idénticas) | smoke, tests, higiene, imports, evaluación, encolado |
| `script/release-gate/known-failures.json` | producción | fallos conocidos con motivo |
| `tests/release-gate.test.mjs` | producción | pruebas de la propia maquinaria |
| `.github/CODEOWNERS` | main y producción | dueño de workflows y del gate |

Rollback: borrar los workflows nuevos y `.github/CODEOWNERS` (o quitar `release-gate` de los checks
obligatorios) y revertir el `tablesFilter` de `drizzle.config.ts` (volvería a dejar que `db:push`
proponga borrar las tablas de la oficina/fábrica). No tocan producción, la base de datos de
producción ni secretos, salvo la vigilancia y la revisión manual, que solo leen (o encolan una
revisión con `apply=true`).
