import assert from "node:assert/strict";
import test from "node:test";
import { getCeoConversationTitle, getLegacyTelegramConversationTitle } from "../server/ceo-conversation-title";

test("builds stable CEO shared conversation titles", () => {
  assert.equal(getCeoConversationTitle("user-1"), "CEO Assistant Conversation (user-1)");
  assert.equal(getLegacyTelegramConversationTitle("user-1"), "Telegram CEO Assistant (user-1)");
});
