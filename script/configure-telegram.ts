import "../server/env-loader";
import { storage } from "../server/storage";
import { hasRealValue } from "../server/ceo-doctor-cli";
import { getTelegramUpdates, sendTelegramPlainMessage } from "../server/telegram";
import { getLatestTelegramChatIdFromUpdates, parseTelegramConfigureArgs, validateTelegramConfigureOptions } from "../server/telegram-config-cli";

async function main() {
  const options = parseTelegramConfigureArgs(process.argv.slice(2));
  const errors = validateTelegramConfigureOptions(options);

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    console.error("Usage: npm run telegram:configure -- --user-id=<real-user-id> --chat-id=<telegram-chat-id> --execute");
    process.exit(1);
  }

  let chatId = options.chatId;
  if (options.latest) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!hasRealValue(botToken)) {
      console.error("TELEGRAM_BOT_TOKEN is required when using --latest.");
      process.exit(1);
    }
    chatId = getLatestTelegramChatIdFromUpdates(await getTelegramUpdates(botToken)) || "";
    if (!chatId) {
      console.error("No Telegram updates found. Send /start to your bot, then retry.");
      process.exit(1);
    }
  }

  const config = await storage.saveTelegramConfig(options.userId, chatId);
  if (options.sendConfirmation) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!hasRealValue(botToken)) {
      console.warn("TELEGRAM_BOT_TOKEN not configured; saved chat config without confirmation message.");
    } else {
      await sendTelegramPlainMessage(botToken, chatId, "BlackOps CEO Assistant conectado. Recibiras briefs y puedes responder aqui.");
    }
  }

  console.log(`Telegram configured for ${config.userId}: ${config.chatId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
