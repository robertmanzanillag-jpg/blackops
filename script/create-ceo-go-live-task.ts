import "../server/env-loader";
import { storage } from "../server/storage";
import { resolveDatabaseConnectionString } from "../server/database-url";
import { DEFAULT_DEV_USER_ID } from "../server/user-context";

const TASK_TITLE = "Activar CEO Assistant + Dropshipping para trabajo real";

const TASK_DESCRIPTION = `Objetivo: conectar cuentas reales, validar seguridad/backup, activar Telegram, preparar Shopify/checkout y dejar Dropshipping CEO listo para operar con approvals antes de gastar o publicar.

Checklist:
1. Crear .env local desde CEO_ASSISTANT_ENV.example sin subir secretos a GitHub.
2. Configurar DATABASE_URL, SESSION_SECRET, AI key, PUBLIC_APP_URL/TELEGRAM_WEBHOOK_URL y TELEGRAM_WEBHOOK_SECRET.
3. Crear usuario admin real y guardar REAL_USER_ID.
4. Migrar datos del usuario mock si aplica.
5. Definir DEFAULT_USER_ID=$REAL_USER_ID.
6. Ejecutar npm run db:push.
7. Ejecutar npm run ceo:db-check -- --json.
8. Conectar Telegram: bot, /start, telegram:configure y webhook.
9. Ejecutar ceo:doctor y ceo:readiness.
10. Confirmar backup preflight, backup real y restore staging.
11. Ejecutar ceo:smoke y ceo:send-brief real.
12. Probar Telegram: health, readiness, brief, pendientes, aprobar ID, rechazar ID.
13. Confirmar historial Telegram en dashboard CEO.
14. Conectar Shopify y crear producto como DRAFT.
15. Confirmar payment processor, tax, shipping, refund, privacy y terms.
16. Hacer orden de prueba antes de vender real.
17. Elegir supplier principal y backup.
18. Comprar sample solo con approval y dentro del budget si aplica.
19. Conectar redes o mantener publishing manual.
20. Publicar solo contenido organico aprobado.
21. Mantener ads en $0 hasta tracking, senal organica, cap diario y approval.
22. Migrar approvals locales desde Dropshipping CEO > Approvals.
23. Cerrar gate final con ceo:go-live.
24. Guardar evidencia no sensible de backup, restore, brief, Telegram e historial.

Guardrails:
- No pegar tokens, passwords, dumps, URLs privadas ni .env en chat o GitHub.
- No comprar inventario.
- No publicar producto real sin draft revisado.
- No gastar en ads sin tracking, cap diario y approval.
- No contactar proveedor, publicar social, comprar sample ni fulfill sin approval.
- No prometer shipping exacto sin evidencia.
- No usar claims medicos, marcas ajenas ni guarantees absolutas.

Documento fuente: docs/ceo-assistant-go-live-task.md`;

function readArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const userId = readArg("--user-id") || process.env.REAL_USER_ID || process.env.DEFAULT_USER_ID || DEFAULT_DEV_USER_ID;
  const dateArg = readArg("--date") || new Date().toISOString();

  const draft = {
    title: TASK_TITLE,
    description: TASK_DESCRIPTION,
    date: new Date(dateArg),
    priority: "high",
    completed: false,
    type: "task",
    isRecurring: false,
  };

  if (!execute) {
    console.log(JSON.stringify({ status: "dry_run", userId, task: { ...draft, date: draft.date.toISOString() } }, null, 2));
    return;
  }

  if (!resolveDatabaseConnectionString()) {
    throw new Error("DATABASE_URL is required before creating the task in the app. Configure Postgres and run npm run db:push first.");
  }

  const existing = (await storage.getTasks(userId)).find((task) => task.title === TASK_TITLE && !task.completed);
  if (existing) {
    console.log(JSON.stringify({ status: "exists", taskId: existing.id, title: existing.title }, null, 2));
    return;
  }

  const task = await storage.createTask(userId, draft);
  console.log(JSON.stringify({ status: "created", taskId: task.id, title: task.title, userId: task.userId }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
