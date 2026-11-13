import { validateRequiredRealCliValue } from "./cli-validation";

export type SendCeoBriefCliOptions = {
  userId: string;
  execute: boolean;
};

export function parseSendCeoBriefArgs(argv: string[]): SendCeoBriefCliOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };

  return {
    userId: getValue("--user-id"),
    execute: argv.includes("--execute"),
  };
}

export function validateSendCeoBriefOptions(options: SendCeoBriefCliOptions): string[] {
  const errors: string[] = [];
  const userIdError = validateRequiredRealCliValue(options.userId, "--user-id");
  if (userIdError) errors.push(userIdError);
  if (!options.execute) {
    errors.push("--execute is required to send a real Telegram CEO brief.");
  }
  return errors;
}
