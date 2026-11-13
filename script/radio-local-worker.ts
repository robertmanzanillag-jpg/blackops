/**
 * radio:local-worker — Runs on the Mac to process queued YouTube→Drive radio clip jobs.
 *
 * Usage:
 *   npm run radio:local-worker
 *
 * Environment:
 *   YT_DLP_COOKIES_FROM_BROWSER=chrome  (default if no cookie source is set)
 *   LOCAL_YOUTUBE_QUEUE_PATH            (optional, defaults to ./data/local-youtube-queue.json)
 *   TELEGRAM_BOT_TOKEN                  (optional, for status notifications)
 *   DATABASE_URL                        (required for Drive OAuth tokens)
 */

import {
  getLocalYoutubeQueue,
  updateLocalYoutubeQueueEntry,
  type LocalYoutubeQueueEntry,
} from "../server/local-youtube-queue";
import { executeDirectRadioYoutubeCommand, formatRadioYoutubeResult } from "../server/radio-youtube-command";

const ESTIMATED_COST_USD = 0;

function applyDefaultCookieSource(): void {
  const hasCookiesPath = process.env.YT_DLP_COOKIES_PATH?.trim();
  const hasCookiesB64 = process.env.YT_DLP_COOKIES_B64?.trim();
  const hasCookiesFromBrowser = process.env.YT_DLP_COOKIES_FROM_BROWSER?.trim();
  const hasAnyChunk = Object.keys(process.env).some((k) => /^YT_DLP_COOKIES_B64_\d+$/.test(k));

  if (!hasCookiesPath && !hasCookiesB64 && !hasCookiesFromBrowser && !hasAnyChunk) {
    process.env.YT_DLP_COOKIES_FROM_BROWSER = "chrome";
    console.log("[radio:local-worker] No cookie source configured — defaulting to --cookies-from-browser chrome");
  } else {
    console.log("[radio:local-worker] Cookie source already configured, skipping chrome default");
  }
}

async function sendTelegramNotification(
  chatId: string | null | undefined,
  message: string,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[radio:local-worker] Telegram notification failed: ${res.status} ${body}`);
    }
  } catch (err) {
    console.warn("[radio:local-worker] Telegram notification error:", err);
  }
}

async function getTelegramChatIdForUser(userId: string): Promise<string | null> {
  try {
    const { storage } = await import("../server/storage");
    const config = await storage.getTelegramConfig(userId);
    return (config?.enabled && config.chatId) ? config.chatId : null;
  } catch {
    return null;
  }
}

async function processEntry(entry: LocalYoutubeQueueEntry): Promise<void> {
  const { id, userId, command } = entry;
  console.log(`\n[radio:local-worker] Processing job ${id}`);
  console.log(`  YouTube URL: ${command.youtubeUrl}`);
  console.log(`  DJ: ${command.djName || "(auto-detect)"}`);
  console.log(`  Drive folder: ${command.driveFolderPath.join("/") || "(from title)"}`);

  updateLocalYoutubeQueueEntry(id, { status: "processing" });

  const chatId = await getTelegramChatIdForUser(userId);

  try {
    const result = await executeDirectRadioYoutubeCommand(command, userId);
    const summary = formatRadioYoutubeResult(result);
    const clipCount = result.clips?.length ?? 0;

    updateLocalYoutubeQueueEntry(id, {
      status: "done",
      processedAt: new Date().toISOString(),
      result,
    });

    const telegramMsg = [
      `✅ Radio clips listos (Mac worker)`,
      `Job: ${id}`,
      `URL: ${command.youtubeUrl}`,
      result.djName ? `DJ: ${result.djName}` : null,
      `Clips generados: ${clipCount}`,
      result.driveFolderPath ? `Drive: ${result.driveFolderPath.join("/")}` : null,
      result.sourceVideoDeleted ? `Limpieza: MP4 largo borrado ✓` : null,
      `Costo estimado: $${(clipCount * ESTIMATED_COST_USD).toFixed(2)} USD`,
      `Nota: herramientas locales gratuitas; Drive solo consume almacenamiento.`,
    ].filter(Boolean).join("\n");

    await sendTelegramNotification(chatId, telegramMsg);
    console.log(`[radio:local-worker] ✓ Job ${id} done — ${clipCount} clips`);
    console.log(summary);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    updateLocalYoutubeQueueEntry(id, {
      status: "failed",
      processedAt: new Date().toISOString(),
      error: errorMessage,
    });

    const telegramMsg = [
      `❌ Radio worker error (Mac local)`,
      `Job: ${id}`,
      `URL: ${command.youtubeUrl}`,
      `Error: ${errorMessage}`,
      `Costo: $0.00 USD`,
    ].join("\n");

    await sendTelegramNotification(chatId, telegramMsg);
    console.error(`[radio:local-worker] ✗ Job ${id} failed:`, errorMessage);
  }
}

async function main(): Promise<void> {
  console.log("=== radio:local-worker ===");
  applyDefaultCookieSource();

  const queue = getLocalYoutubeQueue();
  const pending = queue.filter((e) => e.status === "pending");

  if (pending.length === 0) {
    console.log("[radio:local-worker] No pending jobs in queue. All done.");
    return;
  }

  console.log(`[radio:local-worker] Found ${pending.length} pending job(s).`);

  for (const entry of pending) {
    await processEntry(entry);
  }

  const finalQueue = getLocalYoutubeQueue();
  const done = finalQueue.filter((e) => e.status === "done").length;
  const failed = finalQueue.filter((e) => e.status === "failed").length;
  console.log(`\n[radio:local-worker] Session complete — ${done} done, ${failed} failed.`);
}

main().catch((err) => {
  console.error("[radio:local-worker] Fatal error:", err);
  process.exit(1);
});
