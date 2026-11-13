import type { Express } from "express";
import { closeRevenueAutomationOpportunity, flushRevenueEnginePersistence, prepareRevenueEngineState } from "./revenue-engine";
import { assertRevenueStripeAccount, extractRevenueStripePayment, formatRevenueDealNotification, verifyRevenueStripeWebhook } from "./revenue-stripe";
import { sendPushNotification } from "./push-notifications";
import { storage } from "./storage";
import { sendTelegramPlainMessage } from "./telegram";
import { getCurrentUserId, getSystemUserId } from "./user-context";

async function notifyRevenuePayment(userId: string, message: string, eventId: string) {
  const push = await sendPushNotification(userId, {
    title: message.startsWith("DEAL CERRADO") ? "Deal cerrado" : "Pago confirmado",
    body: message,
    url: "/revenue-engine",
    tag: `revenue-stripe-${eventId}`,
  }).catch(() => ({ success: 0, failed: 1 }));

  const telegramConfig = await storage.getTelegramConfig(userId).catch(() => undefined);
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const telegram = Boolean(
    botToken
      && telegramConfig?.enabled
      && telegramConfig.chatId
      && await sendTelegramPlainMessage(botToken, telegramConfig.chatId, message).catch(() => false),
  );
  return { telegram, push };
}

async function resolveRevenueOwnerUserId(metadataOwnerUserId: string): Promise<string> {
  if (metadataOwnerUserId) return metadataOwnerUserId;
  const enabledTelegramOwners = await storage.getEnabledTelegramConfigs();
  if (enabledTelegramOwners.length === 1) return enabledTelegramOwners[0].userId;
  return getSystemUserId();
}

export function registerRevenueStripeRoutes(app: Express) {
  app.get("/api/stripe/revenue-readiness", async (req, res) => {
    const userId = getCurrentUserId(req);
    const accountId = process.env.REVENUE_STRIPE_ACCOUNT_ID?.trim() || "";
    const webhookSecret = process.env.REVENUE_STRIPE_WEBHOOK_SECRET?.trim() || "";
    const telegramConfig = await storage.getTelegramConfig(userId).catch(() => undefined);
    const checks = {
      accountSeparated: /^acct_[A-Za-z0-9]+$/.test(accountId),
      signedWebhook: webhookSecret.startsWith("whsec_") && webhookSecret.length >= 24,
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && telegramConfig?.enabled && telegramConfig.chatId),
    };
    res.json({
      ready: Object.values(checks).every(Boolean),
      checks,
      webhookPath: "/api/stripe/revenue-webhook",
      notification: "telegram_with_push_fallback",
    });
  });

  app.post("/api/stripe/revenue-webhook", async (req, res) => {
    let activeEventId = "";
    const webhookSecret = process.env.REVENUE_STRIPE_WEBHOOK_SECRET?.trim() || "";
    const expectedAccountId = process.env.REVENUE_STRIPE_ACCOUNT_ID?.trim() || "";
    const signature = req.header("stripe-signature") || "";
    const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : null;

    if (!rawBody || !signature) {
      return res.status(400).json({ received: false, error: "missing_signed_payload" });
    }

    try {
      const event = verifyRevenueStripeWebhook(rawBody, signature, webhookSecret);
      activeEventId = event.id;
      assertRevenueStripeAccount(event, expectedAccountId);
      if (process.env.NODE_ENV === "production" && !event.livemode && process.env.REVENUE_STRIPE_ALLOW_TEST_EVENTS !== "true") {
        return res.status(400).json({ received: false, error: "test_event_blocked_in_production" });
      }

      const payment = extractRevenueStripePayment(event);
      if (!payment) return res.json({ received: true, ignored: true });

      const userId = await resolveRevenueOwnerUserId(payment.ownerUserId);
      const existing = await storage.getRevenueStripeEvent(event.id);
      if (existing?.status === "notified") return res.json({ received: true, duplicate: true, notified: true });
      const processingAgeMs = existing?.receivedAt ? Date.now() - existing.receivedAt.getTime() : 0;
      if (existing?.status === "processing" && processingAgeMs < 5 * 60 * 1000) {
        return res.status(202).json({ received: true, duplicate: true, processing: true });
      }

      if (!existing) {
        const claimed = await storage.createRevenueStripeEvent({
          eventId: event.id,
          accountId: expectedAccountId,
          eventType: event.type,
          objectId: payment.objectId,
          paymentIntentId: payment.paymentIntentId || null,
          opportunityId: payment.opportunityId || null,
          ownerUserId: userId,
          amountCents: payment.amountCents,
          currency: payment.currency,
          status: "processing",
        });
        if (!claimed) return res.json({ received: true, duplicate: true, processing: true });
      }

      let dealRecorded = false;
      let closeStatus = "payment_only";
      const shouldCloseOpportunity = payment.opportunityId
        && (!existing || existing.status === "processing" || existing.status === "failed");
      if (shouldCloseOpportunity) {
        await prepareRevenueEngineState(userId);
        const closeResult = closeRevenueAutomationOpportunity({
          opportunityId: payment.opportunityId,
          cashCollectedUsd: payment.amountCents / 100,
          paymentConfirmation: `Stripe event:${event.id} object:${payment.objectId} payment_intent:${payment.paymentIntentId || "n/a"}`,
          markScopeApproved: payment.scopeApproved,
          notes: "Closed from verified Robert Websites Stripe webhook.",
        });
        await flushRevenueEnginePersistence();
        closeStatus = closeResult.status;
        dealRecorded = closeResult.status === "recorded" || closeResult.status === "already_recorded";
      }

      await storage.updateRevenueStripeEvent(event.id, { status: "processed", processedAt: new Date(), errorMessage: null });
      const message = formatRevenueDealNotification(payment, dealRecorded || !payment.opportunityId);
      const channels = await notifyRevenuePayment(userId, message, event.id);
      const notified = channels.telegram || channels.push.success > 0;
      await storage.updateRevenueStripeEvent(event.id, {
        status: notified ? "notified" : "notification_pending",
        notifiedAt: notified ? new Date() : null,
        errorMessage: notified ? null : "Telegram and push are not configured for the owner.",
      });

      if (!notified) {
        return res.status(503).json({ received: true, dealRecorded, closeStatus, notified: false, channels });
      }
      return res.json({ received: true, dealRecorded, closeStatus, notified, channels });
    } catch (error) {
      if (activeEventId) {
        await storage.updateRevenueStripeEvent(activeEventId, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
      }
      console.error("Revenue Stripe webhook failed:", error instanceof Error ? error.message : error);
      return res.status(400).json({ received: false, error: "invalid_revenue_stripe_event" });
    }
  });
}
