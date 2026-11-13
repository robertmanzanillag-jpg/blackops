// Telegram Bot Integration for Reminders and Chat
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const TELEGRAM_API = "https://api.telegram.org/bot";

interface TelegramMessage {
  chat_id: string;
  text: string;
  parse_mode?: "HTML" | "Markdown";
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
    caption?: string;
    photo?: Array<{
      file_id: string;
      file_unique_id: string;
      width: number;
      height: number;
      file_size?: number;
    }>;
  };
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<boolean> {
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      } as TelegramMessage),
    });

    const result = await response.json();
    if (!result.ok) {
      console.error("Telegram error:", result.description);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error sending Telegram message:", error);
    return false;
  }
}

export async function sendTelegramPhoto(
  botToken: string,
  chatId: string,
  photoPath: string,
  caption?: string
): Promise<boolean> {
  try {
    const data = new FormData();
    data.append("chat_id", chatId);
    if (caption) {
      data.append("caption", caption);
      data.append("parse_mode", "HTML");
    }

    const photo = await readFile(photoPath);
    data.append("photo", new Blob([photo]), path.basename(photoPath));

    const response = await fetch(`${TELEGRAM_API}${botToken}/sendPhoto`, {
      method: "POST",
      body: data,
    });

    const result = await response.json();
    if (!result.ok) {
      console.error("Telegram photo error:", result.description);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error sending Telegram photo:", error);
    return false;
  }
}

export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function isTelegramWebhookSecretValid(expectedSecret?: string, providedSecret?: string | null): boolean {
  if (!expectedSecret) return true;
  if (!providedSecret) return false;

  const expected = Buffer.from(expectedSecret);
  const provided = Buffer.from(providedSecret);

  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export async function sendTelegramPlainMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<boolean> {
  return sendTelegramMessage(botToken, chatId, escapeTelegramHtml(text));
}

export function splitTelegramText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n{2,}/);
  let current = "";

  for (const paragraph of paragraphs) {
    const block = current ? `\n\n${paragraph}` : paragraph;
    if ((current + block).length <= maxLength) {
      current += block;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (paragraph.length <= maxLength) {
      current = paragraph;
      continue;
    }

    const lines = paragraph.split("\n");
    for (const line of lines) {
      const lineBlock = current ? `\n${line}` : line;
      if ((current + lineBlock).length <= maxLength) {
        current += lineBlock;
        continue;
      }

      if (current) {
        chunks.push(current);
        current = "";
      }

      for (let i = 0; i < line.length; i += maxLength) {
        chunks.push(line.slice(i, i + maxLength));
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export async function sendTelegramPlainMessageChunks(
  botToken: string,
  chatId: string,
  text: string,
  maxLength = 3800
): Promise<boolean> {
  const chunks = splitTelegramText(text, maxLength);
  let allSent = true;

  for (const chunk of chunks) {
    const sent = await sendTelegramPlainMessage(botToken, chatId, chunk);
    allSent = allSent && sent;
  }

  return allSent;
}

export async function getTelegramUpdates(botToken: string): Promise<any[]> {
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/getUpdates`);
    const result = await response.json();
    if (result.ok) {
      return result.result;
    }
    return [];
  } catch (error) {
    console.error("Error getting Telegram updates:", error);
    return [];
  }
}

export async function validateTelegramBot(botToken: string): Promise<{ valid: boolean; botName?: string }> {
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/getMe`);
    const result = await response.json();
    if (result.ok) {
      return { valid: true, botName: result.result.username };
    }
    return { valid: false };
  } catch (error) {
    return { valid: false };
  }
}

export async function setTelegramWebhook(botToken: string, webhookUrl: string, secretToken?: string): Promise<boolean> {
  try {
    const payload: { url: string; secret_token?: string } = { url: webhookUrl };
    if (secretToken) {
      payload.secret_token = secretToken;
    }

    const response = await fetch(`${TELEGRAM_API}${botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    console.log("[Telegram] Webhook set result:", result);
    return result.ok;
  } catch (error) {
    console.error("Error setting Telegram webhook:", error);
    return false;
  }
}

export async function deleteTelegramWebhook(botToken: string): Promise<boolean> {
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/deleteWebhook`);
    const result = await response.json();
    return result.ok;
  } catch (error) {
    console.error("Error deleting Telegram webhook:", error);
    return false;
  }
}

export async function getWebhookInfo(botToken: string): Promise<any> {
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/getWebhookInfo`);
    const result = await response.json();
    return result.ok ? result.result : null;
  } catch (error) {
    console.error("Error getting webhook info:", error);
    return null;
  }
}

export { TelegramUpdate };
