const CEO_CONVERSATION_TITLE = "CEO Assistant Conversation";
const LEGACY_TELEGRAM_CONVERSATION_TITLE = "Telegram CEO Assistant";

export function getCeoConversationTitle(userId: string): string {
  return `${CEO_CONVERSATION_TITLE} (${userId})`;
}

export function getLegacyTelegramConversationTitle(userId: string): string {
  return `${LEGACY_TELEGRAM_CONVERSATION_TITLE} (${userId})`;
}
