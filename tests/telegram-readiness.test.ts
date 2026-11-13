import assert from "node:assert/strict";
import test from "node:test";
import { buildTelegramCeoReadinessPayload, buildTelegramHealthPayload } from "../server/telegram-readiness";

const scheduler = {
  timezone: "America/New_York",
  ceoBriefHour: 7,
  ceoBriefMinute: 0,
};

test("Telegram health payload rejects placeholder runtime configuration", () => {
  const payload = buildTelegramHealthPayload({
    aiKey: "your-gemini-key",
    botToken: "replace-with-bot-token",
    webhookSecret: "secret",
    config: { chatId: "12345", enabled: true },
    webhook: { url: "https://example.com/api/telegram/webhook", pending_update_count: 2 },
    expectedWebhookUrl: "https://example.com/api/telegram/webhook",
    scheduler,
  });

  assert.equal(payload.tokenConfigured, false);
  assert.equal(payload.aiConfigured, false);
  assert.equal(payload.webhookSecretConfigured, false);
  assert.equal(payload.readyForBriefs, false);
  assert.equal(payload.readyForChat, false);
  assert.equal(payload.chatConfigured, true);
  assert.equal(payload.webhookMatchesExpected, true);
});

test("Telegram health payload reports ready when real runtime inputs are present", () => {
  const payload = buildTelegramHealthPayload({
    aiKey: "AIza-real-looking-key",
    botToken: "1234567890:real-token-value",
    webhookSecret: "real-webhook-secret-32",
    config: { chatId: "12345", enabled: true },
    webhook: { url: "https://app.example.com/api/telegram/webhook" },
    expectedWebhookUrl: "https://app.example.com/api/telegram/webhook",
    scheduler,
  });

  assert.equal(payload.tokenConfigured, true);
  assert.equal(payload.aiConfigured, true);
  assert.equal(payload.webhookSecretConfigured, true);
  assert.equal(payload.readyForBriefs, true);
  assert.equal(payload.readyForChat, true);
});

test("CEO readiness payload blocks placeholder env values even with chat and webhook present", () => {
  const report = buildTelegramCeoReadinessPayload({
    userId: "mock-user-123",
    devFallbackAllowed: true,
    usingDevFallback: true,
    defaultUserId: "<real-user-id>",
    sessionSecret: "changeme",
    sessionStoreKind: "memory",
    aiKey: "your-gemini-key",
    botToken: "your-bot-token",
    webhookSecret: "your-secret",
    config: { chatId: "12345", enabled: true },
    webhook: { url: "https://app.example.com/api/telegram/webhook" },
    expectedWebhookUrl: "https://app.example.com/api/telegram/webhook",
    scheduler,
  });

  assert.equal(report.ready, false);
  assert.equal(report.status, "blocked");
  assert.equal(report.checks.some((check) => check.id === "assistant_ai" && check.status === "blocked"), true);
  assert.equal(report.checks.some((check) => check.id === "telegram_briefs" && check.status === "blocked"), true);
  assert.equal(report.checks.some((check) => check.id === "telegram_webhook_secret" && check.status === "warning"), true);
});
