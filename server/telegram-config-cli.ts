import { validateRequiredRealCliValue } from "./cli-validation";

export type TelegramConfigureCliOptions = {
  userId: string;
  chatId: string;
  latest: boolean;
  execute: boolean;
  sendConfirmation: boolean;
};

export function parseTelegramConfigureArgs(argv: string[]): TelegramConfigureCliOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };

  return {
    userId: getValue("--user-id"),
    chatId: getValue("--chat-id"),
    latest: argv.includes("--latest"),
    execute: argv.includes("--execute"),
    sendConfirmation: !argv.includes("--no-confirmation"),
  };
}

export function validateTelegramConfigureOptions(options: TelegramConfigureCliOptions): string[] {
  const errors: string[] = [];
  const userIdError = validateRequiredRealCliValue(options.userId, "--user-id");
  if (userIdError) errors.push(userIdError);
  if (!options.latest) {
    const chatIdError = validateRequiredRealCliValue(options.chatId, "--chat-id");
    if (chatIdError) errors.push(chatIdError);
  }
  if (!options.execute) errors.push("--execute is required to write Telegram configuration.");
  return errors;
}

export function getLatestTelegramChatIdFromUpdates(updates: any[]): string | null {
  for (const update of [...updates].reverse()) {
    const chatId = update.message?.chat?.id
      ?? update.channel_post?.chat?.id
      ?? update.edited_message?.chat?.id;
    if (chatId) return String(chatId);
  }
  return null;
}
