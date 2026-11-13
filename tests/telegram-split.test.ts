import assert from "node:assert/strict";
import test from "node:test";
import { isTelegramWebhookSecretValid, splitTelegramText } from "../server/telegram";

test("keeps short Telegram messages as one chunk", () => {
  assert.deepEqual(splitTelegramText("hola CEO", 20), ["hola CEO"]);
});

test("splits long Telegram messages within the requested limit", () => {
  const text = [
    "Resumen ejecutivo",
    "",
    "A".repeat(12),
    "",
    "B".repeat(12),
    "",
    "C".repeat(12),
  ].join("\n");

  const chunks = splitTelegramText(text, 20);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 20));
  assert.equal(chunks.join("\n\n"), text);
});

test("validates Telegram webhook secret only when configured", () => {
  assert.equal(isTelegramWebhookSecretValid(undefined, undefined), true);
  assert.equal(isTelegramWebhookSecretValid("", undefined), true);
  assert.equal(isTelegramWebhookSecretValid("secret-token", "secret-token"), true);
  assert.equal(isTelegramWebhookSecretValid("secret-token", undefined), false);
  assert.equal(isTelegramWebhookSecretValid("secret-token", "wrong-token"), false);
  assert.equal(isTelegramWebhookSecretValid("secret-token", "short"), false);
});
