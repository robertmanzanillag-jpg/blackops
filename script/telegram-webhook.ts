import "../server/env-loader";
import { getTelegramWebhookStatus, resolveTelegramWebhookUrl, setupTelegramWebhook } from "../server/telegram-chat";
import { hasStrongSecret } from "../server/ceo-doctor-cli";
import { parseTelegramWebhookArgs, validateTelegramWebhookOptions } from "../server/telegram-webhook-cli";

async function main() {
  const options = parseTelegramWebhookArgs(process.argv.slice(2));
  const errors = validateTelegramWebhookOptions(options);

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    console.error("Usage: npm run telegram:webhook -- status");
    console.error("Usage: npm run telegram:webhook -- setup --execute");
    process.exit(1);
  }

  if (options.command === "setup") {
    const result = await setupTelegramWebhook();
    console.log(result.message);
    process.exit(result.success ? 0 : 1);
  }

  const expectedWebhookUrl = resolveTelegramWebhookUrl();
  const status = await getTelegramWebhookStatus();
  console.log(JSON.stringify({
    expectedWebhookUrl,
    webhookUrl: status?.url || null,
    webhookMatchesExpected: Boolean(expectedWebhookUrl && status?.url === expectedWebhookUrl),
    pendingUpdates: status?.pending_update_count || 0,
    lastError: status?.last_error_message || null,
    secretConfigured: hasStrongSecret(process.env.TELEGRAM_WEBHOOK_SECRET, 16),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
