import assert from "node:assert/strict";
import test from "node:test";
import { resolveTelegramWebhookUrl, setupTelegramWebhook } from "../server/telegram-chat";

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("resolves Telegram webhook URL only from real public URL values", () => {
  withEnv({
    TELEGRAM_WEBHOOK_URL: "https://your-domain.example/api/telegram/webhook",
    PUBLIC_APP_URL: undefined,
    REPLIT_DOMAINS: undefined,
    REPLIT_DEV_DOMAIN: undefined,
    REPL_SLUG: undefined,
    REPL_OWNER: undefined,
  }, () => {
    assert.equal(resolveTelegramWebhookUrl(), null);
  });

  withEnv({
    TELEGRAM_WEBHOOK_URL: undefined,
    PUBLIC_APP_URL: "https://app.blackroomus.com",
    REPLIT_DOMAINS: undefined,
    REPLIT_DEV_DOMAIN: undefined,
    REPL_SLUG: undefined,
    REPL_OWNER: undefined,
  }, () => {
    assert.equal(resolveTelegramWebhookUrl(), "https://app.blackroomus.com/api/telegram/webhook");
  });
});

test("setupTelegramWebhook fails closed before network calls without HTTPS URL and strong secret", async () => {
  await withEnv({
    TELEGRAM_BOT_TOKEN: "1234567890:real-bot-token-value",
    TELEGRAM_WEBHOOK_URL: "http://app.blackroomus.com/api/telegram/webhook",
    PUBLIC_APP_URL: undefined,
    REPLIT_DOMAINS: undefined,
    REPLIT_DEV_DOMAIN: undefined,
    REPL_SLUG: undefined,
    REPL_OWNER: undefined,
    TELEGRAM_WEBHOOK_SECRET: "real-webhook-secret-32",
  }, async () => {
    assert.deepEqual(await setupTelegramWebhook(), {
      success: false,
      message: "Webhook URL must be a real HTTPS URL",
    });
  });

  await withEnv({
    TELEGRAM_BOT_TOKEN: "1234567890:real-bot-token-value",
    TELEGRAM_WEBHOOK_URL: "https://app.blackroomus.com/api/telegram/webhook",
    PUBLIC_APP_URL: undefined,
    REPLIT_DOMAINS: undefined,
    REPLIT_DEV_DOMAIN: undefined,
    REPL_SLUG: undefined,
    REPL_OWNER: undefined,
    TELEGRAM_WEBHOOK_SECRET: "secret",
  }, async () => {
    assert.deepEqual(await setupTelegramWebhook(), {
      success: false,
      message: "TELEGRAM_WEBHOOK_SECRET must be a real random secret with at least 16 characters",
    });
  });
});
