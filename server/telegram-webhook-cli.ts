export type TelegramWebhookCliCommand = "status" | "setup";

export type TelegramWebhookCliOptions = {
  command: TelegramWebhookCliCommand;
  execute: boolean;
};

export function parseTelegramWebhookArgs(argv: string[]): TelegramWebhookCliOptions {
  const commandArg = argv.find((value) => value === "status" || value === "setup") as TelegramWebhookCliCommand | undefined;

  return {
    command: commandArg || "status",
    execute: argv.includes("--execute"),
  };
}

export function validateTelegramWebhookOptions(options: TelegramWebhookCliOptions): string[] {
  const errors: string[] = [];
  if (options.command === "setup" && !options.execute) {
    errors.push("--execute is required to register a real Telegram webhook.");
  }
  return errors;
}
