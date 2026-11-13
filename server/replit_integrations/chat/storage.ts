import { db } from "../../db";
import { conversations, messages } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

function ownerTitlePrefix(userId: string): string {
  return `[owner:${Buffer.from(userId).toString("base64url")}] `;
}

function scopedConversationTitle(title: string, userId?: string): string {
  return userId ? `${ownerTitlePrefix(userId)}${title}` : title;
}

export function stripScopedConversationTitle(title: string): string {
  return title.replace(/^\[owner:[^\]]+\]\s*/, "");
}

export interface IChatStorage {
  getConversation(id: number, userId?: string): Promise<typeof conversations.$inferSelect | undefined>;
  getConversationByTitle(title: string, userId?: string): Promise<typeof conversations.$inferSelect | undefined>;
  getAllConversations(userId?: string): Promise<(typeof conversations.$inferSelect)[]>;
  createConversation(title: string, userId?: string): Promise<typeof conversations.$inferSelect>;
  deleteConversation(id: number, userId?: string): Promise<void>;
  getMessagesByConversation(conversationId: number): Promise<(typeof messages.$inferSelect)[]>;
  createMessage(conversationId: number, role: string, content: string): Promise<typeof messages.$inferSelect>;
}

export const chatStorage: IChatStorage = {
  async getConversation(id: number, userId?: string) {
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (conversation && userId && !conversation.title.startsWith(ownerTitlePrefix(userId))) {
      return undefined;
    }
    return conversation;
  },

  async getConversationByTitle(title: string, userId?: string) {
    const [conversation] = await db.select().from(conversations).where(eq(conversations.title, scopedConversationTitle(title, userId)));
    return conversation;
  },

  async getAllConversations(userId?: string) {
    const allConversations = await db.select().from(conversations).orderBy(desc(conversations.createdAt));
    if (!userId) return allConversations;
    const prefix = ownerTitlePrefix(userId);
    return allConversations.filter((conversation) => conversation.title.startsWith(prefix));
  },

  async createConversation(title: string, userId?: string) {
    const [conversation] = await db.insert(conversations).values({ title: scopedConversationTitle(title, userId) }).returning();
    return conversation;
  },

  async deleteConversation(id: number, userId?: string) {
    if (userId && !(await this.getConversation(id, userId))) return;
    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversations).where(eq(conversations.id, id));
  },

  async getMessagesByConversation(conversationId: number) {
    return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt);
  },

  async createMessage(conversationId: number, role: string, content: string) {
    const [message] = await db.insert(messages).values({ conversationId, role, content }).returning();
    return message;
  },
};
