import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Telegram chat saves assistant-side failures into shared CEO history", () => {
  const source = readFileSync("server/telegram-chat.ts", "utf8");

  assert.match(source, /missingAiMessage = "❌ Error: API de IA no configurada\."/);
  assert.match(source, /saveConversationMessage: saveCeoConversationMessage/);
  assert.match(source, /deps\.saveConversationMessage\(userId, "assistant", missingAiMessage\)/);
});

test("Telegram chat never sends an empty assistant response", () => {
  const source = readFileSync("server/telegram-chat.ts", "utf8");

  assert.match(source, /if \(!responseToSend\.trim\(\)\)/);
  assert.match(source, /No pude generar una respuesta útil esta vez/);
  assert.match(source, /deps\.saveConversationMessage\(userId, "assistant", responseToSend\)/);
});
