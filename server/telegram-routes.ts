import type { Express } from "express";
import { storage } from "./storage";
import { getCurrentUserId, DEFAULT_DEV_USER_ID, allowsDevUserFallback } from "./user-context";
import { sendTelegramMessage, isTelegramWebhookSecretValid } from "./telegram";
import { handleTelegramMessage, setupTelegramWebhook, getTelegramWebhookStatus, resolveTelegramWebhookUrl } from "./telegram-chat";
import { testCeoMorningBrief, getReminderSchedulerConfig } from "./reminder-scheduler";
import { getCeoConversationMessages } from "./ceo-conversation-history";
import { resolveSessionRuntimeSettings } from "./session-config-core";
import { createRateLimiter } from "./rate-limit";
import { createTelegramUpdateDeduper, shouldProcessTelegramUpdate } from "./telegram-webhook-dedupe";
import { registerShopifyRoutes } from "./shopify-routes";
import { hasRealValue, hasStrongSecret } from "./ceo-doctor-cli";
import { buildTelegramCeoReadinessPayload, buildTelegramHealthPayload } from "./telegram-readiness";
import {
  CEO_GO_LIVE_EVIDENCE_CATEGORY,
  buildCeoGoLiveEvidenceMutation,
  buildCeoGoLiveEvidenceMeta,
  buildCeoGoLiveEvidenceFlags,
  buildCeoGoLiveReport,
  parseCeoGoLiveEvidenceConfirmation,
} from "./ceo-go-live-cli";

function readOptionalBooleanFlag(req: { query: any; body?: any }, name: string): boolean | null {
  const queryValue = req.query?.[name];
  const bodyValue = req.body?.[name];
  return parseCeoGoLiveEvidenceConfirmation(bodyValue ?? queryValue);
}

async function readGoLiveEvidenceFlags(userId: string) {
  const evidence = await storage.getUserProfileDataByCategory(userId, CEO_GO_LIVE_EVIDENCE_CATEGORY);
  return {
    flags: buildCeoGoLiveEvidenceFlags(evidence.map((item) => item.key)),
    meta: buildCeoGoLiveEvidenceMeta(evidence.map((item) => ({
      key: item.key,
      value: item.value,
      source: item.source,
    }))),
  };
}

export function registerTelegramRoutes(app: Express): void {
  registerShopifyRoutes(app);

  const telegramWebhookRateLimit = createRateLimiter({
    scope: "telegram-webhook",
    limit: 180,
    windowMs: 60 * 1000,
    persistentStore: storage,
    onPersistentError: (error) => {
      console.warn("[RateLimit] Persistent telegram-webhook limiter unavailable; using in-memory fallback:", error instanceof Error ? error.message : error);
    },
  });
  const telegramUpdateDeduper = createTelegramUpdateDeduper();

  app.get("/api/telegram/status", async (req, res) => {
    try {
      const config = await storage.getTelegramConfig(getCurrentUserId(req));
      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      if (!hasRealValue(botToken)) {
        return res.json({ configured: false, enabled: false, reason: "no_token" });
      }

      if (!config) {
        return res.json({ configured: false, enabled: false, reason: "no_chat_id" });
      }

      res.json({
        configured: true,
        enabled: config.enabled,
        chatId: config.chatId,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get telegram status" });
    }
  });

  app.get("/api/telegram/health", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const config = await storage.getTelegramConfig(userId);
      const webhook = botToken ? await getTelegramWebhookStatus().catch(() => null) : null;
      const expectedWebhookUrl = resolveTelegramWebhookUrl();

      res.json(buildTelegramHealthPayload({
        aiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
        botToken,
        webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
        config,
        webhook,
        expectedWebhookUrl,
        scheduler: getReminderSchedulerConfig(),
      }));
    } catch (error) {
      res.status(500).json({ error: "Failed to get Telegram health" });
    }
  });

  app.get("/api/ceo/readiness", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const config = await storage.getTelegramConfig(userId);
      const webhook = botToken ? await getTelegramWebhookStatus().catch(() => null) : null;
      const expectedWebhookUrl = resolveTelegramWebhookUrl();
      const scheduler = getReminderSchedulerConfig();
      const sessionSettings = resolveSessionRuntimeSettings();

      res.json(buildTelegramCeoReadinessPayload({
        userId,
        devFallbackAllowed: allowsDevUserFallback(),
        usingDevFallback: userId === DEFAULT_DEV_USER_ID && !hasRealValue(process.env.DEFAULT_USER_ID),
        defaultUserId: process.env.DEFAULT_USER_ID,
        sessionSecret: process.env.SESSION_SECRET,
        sessionStoreKind: sessionSettings.storeKind,
        aiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
        botToken,
        webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
        config,
        webhook,
        expectedWebhookUrl,
        scheduler: {
          timezone: scheduler.timezone,
          ceoBriefHour: scheduler.ceoBriefHour,
          ceoBriefMinute: scheduler.ceoBriefMinute,
        },
      }));
    } catch (error) {
      res.status(500).json({ error: "Failed to get CEO readiness" });
    }
  });

  app.get("/api/ceo/go-live", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const config = await storage.getTelegramConfig(userId);
      const chatId = config?.chatId || "";
      const evidence = await readGoLiveEvidenceFlags(userId);

      res.json(buildCeoGoLiveReport({
        userId,
        chatId,
        json: true,
        execute: false,
        confirmCheckId: "",
        revokeCheckId: "",
        evidenceNote: "",
        ...evidence.flags,
        evidence: evidence.meta,
      }));
    } catch (error) {
      res.status(500).json({ error: "Failed to get CEO go-live gate" });
    }
  });

  app.post("/api/ceo/go-live/evidence", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const checkId = String(req.body?.checkId || "").trim();
      const confirmed = readOptionalBooleanFlag(req, "confirmed");
      const { mutation, error } = buildCeoGoLiveEvidenceMutation({ checkId, confirmed, note: req.body?.note });

      if (error || !mutation) return res.status(400).json({ error });

      if (mutation.action === "save") {
        await storage.saveUserProfileData(userId, {
          userId,
          category: CEO_GO_LIVE_EVIDENCE_CATEGORY,
          key: mutation.key,
          value: mutation.value,
          confidence: "confirmed",
          source: mutation.source,
        });
      } else {
        const existing = await storage.getUserProfileDataByKey(userId, mutation.key);
        if (existing) await storage.deleteUserProfileData(existing.id);
      }

      const config = await storage.getTelegramConfig(userId);
      const evidence = await readGoLiveEvidenceFlags(userId);

      res.json(buildCeoGoLiveReport({
        userId,
        chatId: config?.chatId || "",
        json: true,
        execute: false,
        confirmCheckId: "",
        revokeCheckId: "",
        evidenceNote: "",
        ...evidence.flags,
        evidence: evidence.meta,
      }));
    } catch (error) {
      res.status(500).json({ error: "Failed to save CEO go-live evidence" });
    }
  });

  app.get("/api/ceo/conversation-history", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const limit = Math.min(Number(req.query.limit || 12) || 12, 50);
      const messages = await getCeoConversationMessages(userId, limit);
      res.json({
        messages: messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        })),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get CEO conversation history" });
    }
  });

  app.post("/api/telegram/test-ceo-brief", async (req, res) => {
    try {
      const result = await testCeoMorningBrief(getCurrentUserId(req));
      res.status(result.success ? 200 : 500).json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to send CEO brief" });
    }
  });

  app.post("/api/telegram/configure", async (req, res) => {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!hasRealValue(botToken)) {
        return res.status(400).json({ error: "TELEGRAM_BOT_TOKEN not configured" });
      }

      const chatId = String(req.body?.chatId || "").trim();

      if (!chatId) {
        return res.status(400).json({
          error: "chatId is required",
          instruction: "Use npm run telegram:configure -- --user-id=<real-user-id> --latest --execute after sending /start, or provide chatId explicitly.",
        });
      }

      const config = await storage.saveTelegramConfig(getCurrentUserId(req), chatId);
      await sendTelegramMessage(botToken, chatId, "✅ BlackOps Reminder conectado! Recibirás notificaciones aquí.");

      res.json({ success: true, chatId, config });
    } catch (error) {
      res.status(500).json({ error: "Failed to configure telegram" });
    }
  });

  app.post("/api/telegram/toggle", async (req, res) => {
    try {
      const { enabled } = req.body;
      const config = await storage.updateTelegramConfig(getCurrentUserId(req), enabled);

      if (!config) {
        return res.status(404).json({ error: "Telegram not configured" });
      }

      res.json({ success: true, enabled: config.enabled });
    } catch (error) {
      res.status(500).json({ error: "Failed to toggle telegram" });
    }
  });

  app.post("/api/telegram/test", async (req, res) => {
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!hasRealValue(botToken)) {
        return res.status(400).json({ error: "TELEGRAM_BOT_TOKEN not configured" });
      }

      const config = await storage.getTelegramConfig(getCurrentUserId(req));
      if (!config) {
        return res.status(400).json({ error: "Telegram not configured. Send /start to your bot first." });
      }

      const success = await sendTelegramMessage(
        botToken,
        config.chatId,
        "🧪 Prueba de notificación\n\nEsta es una notificación de prueba de BlackOps Reminder.",
      );

      if (success) {
        res.json({ success: true, message: "Test notification sent" });
      } else {
        res.status(500).json({ error: "Failed to send test notification" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to send test notification" });
    }
  });

  app.delete("/api/telegram/disconnect", async (req, res) => {
    try {
      await storage.deleteTelegramConfig(getCurrentUserId(req));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to disconnect telegram" });
    }
  });

  app.post("/api/telegram/webhook", telegramWebhookRateLimit, async (req, res) => {
    try {
      const providedSecret = req.header("x-telegram-bot-api-secret-token");
      if (process.env.TELEGRAM_WEBHOOK_SECRET && !hasStrongSecret(process.env.TELEGRAM_WEBHOOK_SECRET, 16)) {
        console.warn("[Telegram Webhook] Rejected update because TELEGRAM_WEBHOOK_SECRET is not a strong configured value");
        return res.status(503).json({ ok: false, error: "telegram_webhook_secret_invalid" });
      }
      if (!isTelegramWebhookSecretValid(process.env.TELEGRAM_WEBHOOK_SECRET, providedSecret)) {
        console.warn("[Telegram Webhook] Rejected update with invalid secret token");
        return res.status(401).json({ ok: false });
      }

      const update = req.body;
      console.log("[Telegram Webhook] Received update:", JSON.stringify(update).slice(0, 200));

      const shouldProcess = await shouldProcessTelegramUpdate(update, storage, telegramUpdateDeduper, (error) => {
        console.warn("[Telegram Webhook] Durable dedupe unavailable; using in-memory fallback:", error instanceof Error ? error.message : error);
      });
      if (!shouldProcess) {
        console.log(`[Telegram Webhook] Duplicate update skipped: ${update.update_id}`);
        return res.status(200).json({ ok: true, duplicate: true });
      }

      handleTelegramMessage(update).catch(err => {
        console.error("[Telegram Webhook] Error handling message:", err);
      });

      res.status(200).json({ ok: true });
    } catch (error) {
      console.error("[Telegram Webhook] Error:", error);
      res.status(200).json({ ok: true });
    }
  });

  app.post("/api/telegram/setup-webhook", async (_req, res) => {
    try {
      const result = await setupTelegramWebhook();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to setup webhook" });
    }
  });

  app.get("/api/telegram/webhook-status", async (_req, res) => {
    try {
      const status = await getTelegramWebhookStatus();
      res.json(status || { url: null, pending_update_count: 0 });
    } catch (error) {
      res.status(500).json({ error: "Failed to get webhook status" });
    }
  });
}
