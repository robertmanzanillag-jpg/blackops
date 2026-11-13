import assert from "node:assert/strict";
import test from "node:test";
import { handleTelegramMessageWithDeps, type TelegramMessageHandlerDeps } from "../server/telegram-chat";
import type { TelegramUpdate } from "../server/telegram";

function textUpdate(chatId: number, text: string): TelegramUpdate {
  return {
    update_id: 123,
    message: {
      message_id: 1,
      from: { id: 99, first_name: "Robert" },
      chat: { id: chatId, type: "private" },
      date: 1_789_000_000,
      text,
    },
  };
}

function createDeps(overrides: Partial<TelegramMessageHandlerDeps> = {}): TelegramMessageHandlerDeps {
  return {
    getBotToken: () => "real-telegram-bot-token",
    getAiKey: () => undefined,
    getTelegramConfigByChatId: async () => undefined,
    saveTelegramConfig: async (userId, _chatId) => ({ userId, enabled: true }),
    sendPlainMessage: async () => true,
    sendPlainMessageChunks: async () => true,
    saveConversationMessage: async () => undefined,
    handleControlCommand: async () => null,
    handleWorkRequest: async () => null,
    ...overrides,
  };
}

test("handleTelegramMessage tells unknown chats to connect without binding them to a user", async () => {
  const sent: Array<{ chatId: string; text: string }> = [];
  let saveConfigCalls = 0;
  let savedConversationCalls = 0;

  await handleTelegramMessageWithDeps(textUpdate(456, "hola"), createDeps({
    getTelegramConfigByChatId: async () => undefined,
    saveTelegramConfig: async (userId, chatId) => {
      saveConfigCalls += 1;
      return { userId, enabled: true };
    },
    sendPlainMessage: async (_botToken, chatId, text) => {
      sent.push({ chatId, text });
      return true;
    },
    saveConversationMessage: async () => {
      savedConversationCalls += 1;
    },
  }));

  assert.equal(saveConfigCalls, 0);
  assert.equal(savedConversationCalls, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, "456");
  assert.match(sent[0].text, /todavía no está vinculado/);
  assert.match(sent[0].text, /telegram:configure/);
});

test("handleTelegramMessage enables a known disabled chat and saves missing-AI response", async () => {
  const sent: Array<{ kind: "plain" | "chunks"; chatId: string; text: string }> = [];
  const savedConversation: Array<{ userId: string; role: string; content: string }> = [];
  let savedConfig: { userId: string; chatId: string } | null = null;

  await handleTelegramMessageWithDeps(textUpdate(789, "cuentame mi estado"), createDeps({
    getTelegramConfigByChatId: async () => ({ userId: "real-user-1", enabled: false }),
    saveTelegramConfig: async (userId, chatId) => {
      savedConfig = { userId, chatId };
      return { userId, enabled: true };
    },
    sendPlainMessage: async (_botToken, chatId, text) => {
      sent.push({ kind: "plain", chatId, text });
      return true;
    },
    sendPlainMessageChunks: async (_botToken, chatId, text) => {
      sent.push({ kind: "chunks", chatId, text });
      return true;
    },
    saveConversationMessage: async (userId, role, content) => {
      savedConversation.push({ userId, role, content });
    },
  }));

  assert.deepEqual(savedConfig, { userId: "real-user-1", chatId: "789" });
  assert.deepEqual(savedConversation, [
    { userId: "real-user-1", role: "user", content: "cuentame mi estado" },
    { userId: "real-user-1", role: "assistant", content: "❌ Error: API de IA no configurada." },
  ]);
  assert.deepEqual(sent, [
    { kind: "plain", chatId: "789", text: "❌ Error: API de IA no configurada." },
  ]);
});
