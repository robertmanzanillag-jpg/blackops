import assert from "node:assert/strict";
import test from "node:test";
import { parseTelegramWebhookArgs, validateTelegramWebhookOptions } from "../server/telegram-webhook-cli";

test("parses Telegram webhook CLI options", () => {
  assert.deepEqual(parseTelegramWebhookArgs([]), { command: "status", execute: false });
  assert.deepEqual(parseTelegramWebhookArgs(["status"]), { command: "status", execute: false });
  assert.deepEqual(parseTelegramWebhookArgs(["setup", "--execute"]), { command: "setup", execute: true });
});

test("requires execute flag before registering Telegram webhook", () => {
  assert.deepEqual(validateTelegramWebhookOptions({ command: "status", execute: false }), []);
  assert.deepEqual(validateTelegramWebhookOptions({ command: "setup", execute: false }), [
    "--execute is required to register a real Telegram webhook.",
  ]);
  assert.deepEqual(validateTelegramWebhookOptions({ command: "setup", execute: true }), []);
});
