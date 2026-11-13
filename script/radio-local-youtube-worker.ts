import { setTimeout as sleep } from "node:timers/promises";
import { storage } from "../server/storage";
import { loadLocalEnvFiles } from "../server/env-loader-core";
import { getSystemUserId } from "../server/user-context";
import { executeApprovedPendingAction } from "../server/trust-executor";
import { formatRadioYoutubeResult } from "../server/radio-youtube-command";
import { isLocalYoutubeWorkerAction } from "../server/local-youtube-worker-queue";
import { sendTelegramPlainMessage } from "../server/telegram";
import type { PendingAction } from "@shared/schema";

type WorkerOptions = {
  once: boolean;
  intervalMs: number;
  limit: number;
  userId: string;
};

function parseArgs(argv: string[]): WorkerOptions {
  const readValue = (name: string): string | undefined => {
    const inline = argv.find((arg) => arg.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const once = argv.includes("--once") || process.env.RADIO_LOCAL_WORKER_ONCE === "true";
  const intervalSeconds = Number(readValue("--interval") || process.env.RADIO_LOCAL_WORKER_INTERVAL_SECONDS || "30");
  const limit = Number(readValue("--limit") || process.env.RADIO_LOCAL_WORKER_LIMIT || "3");
  const userId = readValue("--user-id") || process.env.LOCAL_YOUTUBE_WORKER_USER_ID || getSystemUserId();

  return {
    once,
    intervalMs: Math.max(5_000, Math.min(10 * 60 * 1000, Math.floor(intervalSeconds * 1000))),
    limit: Math.max(1, Math.min(10, Number.isFinite(limit) ? Math.floor(limit) : 3)),
    userId,
  };
}

function configureLocalYoutubeDefaults(): void {
  process.env.LOCAL_YOUTUBE_WORKER_RUNNER = "1";
  process.env.RADIO_YOUTUBE_LOCAL_WORKER_MODE ||= "enabled";
  process.env.YT_DLP_COOKIES_FROM_BROWSER ||= "chrome";
  process.env.YT_DLP_AUTO_UPDATE ||= "true";
  process.env.YT_DLP_JS_RUNTIMES ||= "node";
  process.env.YT_DLP_MAX_VARIANTS ||= "24";
}

function telegramToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token && !/^(changeme|replace|your-|todo)$/i.test(token) ? token : null;
}

async function notifyTelegram(userId: string, text: string): Promise<void> {
  const token = telegramToken();
  if (!token) return;
  const config = await storage.getTelegramConfig(userId).catch(() => undefined);
  if (!config?.enabled || !config.chatId) return;
  await sendTelegramPlainMessage(token, config.chatId, text).catch((error) => {
    console.warn("[radio-local-worker] Telegram notify failed:", error instanceof Error ? error.message : error);
  });
}

async function approveForLocalWorker(action: PendingAction, userId: string): Promise<PendingAction> {
  const approved = await storage.updatePendingAction(action.id, {
    status: "approved",
    approvedBy: userId,
    approvedAt: new Date(),
    approvalReason: "Ejecutado por Mac local worker",
  });
  await storage.createPendingActionEvent({
    pendingActionId: action.id,
    userId: action.userId,
    actorType: "system",
    actorId: "mac-local-youtube-worker",
    eventType: "approved",
    previousStatus: action.status,
    nextStatus: "approved",
    note: "Mac local worker tomó el trabajo de la cola.",
    metadata: { runner: "mac-local-youtube-worker" },
  });
  return approved;
}

async function runQueuedAction(action: PendingAction, userId: string): Promise<void> {
  await notifyTelegram(userId, [
    "Estoy trabajando en tu video de YouTube desde la Mac.",
    `ID de cola: ${action.id}`,
    "Estado: descargando/procesando con Chrome local.",
    "Gasto estimado de esta corrida: $0.00 USD.",
  ].join("\n"));

  const approved = await approveForLocalWorker(action, userId);
  const result = await executeApprovedPendingAction(approved, "mac-local-youtube-worker");
  if (!result.success) {
    await notifyTelegram(userId, [
      "No pude completar el video desde la Mac.",
      `ID de cola: ${action.id}`,
      `Error: ${result.error || "error desconocido"}`,
      "Gasto estimado de esta corrida: $0.00 USD.",
    ].join("\n"));
    return;
  }

  const summary = formatRadioYoutubeResult(result.result as any);
  await notifyTelegram(userId, summary);
}

async function claimLocalWorkerActions(userId: string, limit: number): Promise<PendingAction[]> {
  const actions = await storage.getPendingActions(userId);
  return actions
    .filter(isLocalYoutubeWorkerAction)
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    .slice(0, limit);
}

async function runOnce(options: WorkerOptions): Promise<number> {
  const actions = await claimLocalWorkerActions(options.userId, options.limit);
  if (!actions.length) {
    console.log("[radio-local-worker] No queued YouTube jobs.");
    return 0;
  }

  for (const action of actions) {
    console.log(`[radio-local-worker] Running queued job ${action.id}`);
    await runQueuedAction(action, options.userId);
  }

  return actions.length;
}

async function main(): Promise<void> {
  const loadedEnv = loadLocalEnvFiles(process.cwd());
  configureLocalYoutubeDefaults();
  const options = parseArgs(process.argv.slice(2));
  console.log("[radio-local-worker] Started", {
    userId: options.userId,
    once: options.once,
    intervalMs: options.intervalMs,
    loadedEnv,
    cookiesFromBrowser: process.env.YT_DLP_COOKIES_FROM_BROWSER || null,
  });

  do {
    await runOnce(options);
    if (options.once) break;
    await sleep(options.intervalMs);
  } while (true);
}

main().catch((error) => {
  console.error("[radio-local-worker] Fatal:", error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
