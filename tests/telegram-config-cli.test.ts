import assert from "node:assert/strict";
import test from "node:test";
import { getLatestTelegramChatIdFromUpdates, parseTelegramConfigureArgs, validateTelegramConfigureOptions } from "../server/telegram-config-cli";

test("parses Telegram configure CLI options", () => {
  assert.deepEqual(parseTelegramConfigureArgs([
    "--user-id=user-123",
    "--chat-id=12345",
    "--execute",
  ]), {
    userId: "user-123",
    chatId: "12345",
    latest: false,
    execute: true,
    sendConfirmation: true,
  });

  assert.equal(parseTelegramConfigureArgs(["--latest"]).latest, true);
  assert.equal(parseTelegramConfigureArgs(["--no-confirmation"]).sendConfirmation, false);
});

test("validates Telegram configure CLI options", () => {
  assert.deepEqual(validateTelegramConfigureOptions({
    userId: "",
    chatId: "",
    latest: false,
    execute: false,
    sendConfirmation: true,
  }), [
    "--user-id must be a real value, not a placeholder.",
    "--chat-id must be a real value, not a placeholder.",
    "--execute is required to write Telegram configuration.",
  ]);

  assert.deepEqual(validateTelegramConfigureOptions({
    userId: "<real-user-id>",
    chatId: "<telegram-chat-id>",
    latest: false,
    execute: true,
    sendConfirmation: true,
  }), [
    "--user-id must be a real value, not a placeholder.",
    "--chat-id must be a real value, not a placeholder.",
  ]);

  assert.deepEqual(validateTelegramConfigureOptions({
    userId: "user-123",
    chatId: "",
    latest: true,
    execute: true,
    sendConfirmation: true,
  }), []);
});

test("resolves latest Telegram chat id from updates", () => {
  assert.equal(getLatestTelegramChatIdFromUpdates([
    { message: { chat: { id: 111 } } },
    { channel_post: { chat: { id: "-222" } } },
  ]), "-222");

  assert.equal(getLatestTelegramChatIdFromUpdates([
    { update_id: 1 },
    { edited_message: { chat: { id: 333 } } },
  ]), "333");

  assert.equal(getLatestTelegramChatIdFromUpdates([{ update_id: 1 }]), null);
});
