import { chatStorage } from "./replit_integrations/chat/storage";
import { getCeoConversationTitle, getLegacyTelegramConversationTitle } from "./ceo-conversation-title";

export { getCeoConversationTitle, getLegacyTelegramConversationTitle };

async function getOrCreateCeoConversation(userId: string) {
  const existing = await chatStorage.getConversationByTitle(getCeoConversationTitle(userId));
  if (existing) return existing;
  return chatStorage.createConversation(getCeoConversationTitle(userId));
}

export async function saveCeoConversationMessage(userId: string, role: "user" | "assistant", content: string): Promise<void> {
  const conversation = await getOrCreateCeoConversation(userId);
  await chatStorage.createMessage(conversation.id, role, content);
}

export async function getCeoConversationHistory(
  userId: string,
  limit = 12,
  excludeLatestUserContent?: string,
): Promise<string> {
  const recent = await getCeoConversationMessages(userId, limit, excludeLatestUserContent);

  if (recent.length === 0) {
    return "No hay historial compartido previo.";
  }

  return recent
    .map((message) => `${message.role === "assistant" ? "Assistant" : "Usuario"}: ${message.content}`)
    .join("\n");
}

export async function getCeoConversationMessages(
  userId: string,
  limit = 12,
  excludeLatestUserContent?: string,
) {
  const conversations = await Promise.all([
    chatStorage.getConversationByTitle(getCeoConversationTitle(userId)),
    chatStorage.getConversationByTitle(getLegacyTelegramConversationTitle(userId)),
  ]);
  const uniqueConversations = conversations
    .filter(Boolean)
    .filter((conversation, index, array) => array.findIndex((candidate) => candidate?.id === conversation?.id) === index);

  const messageGroups = await Promise.all(
    uniqueConversations.map((conversation) => chatStorage.getMessagesByConversation(conversation!.id)),
  );
  let recent = messageGroups
    .flat()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-limit);

  if (
    excludeLatestUserContent &&
    recent.length > 0 &&
    recent[recent.length - 1].role === "user" &&
    recent[recent.length - 1].content === excludeLatestUserContent
  ) {
    recent = recent.slice(0, -1);
  }

  return recent;
}
