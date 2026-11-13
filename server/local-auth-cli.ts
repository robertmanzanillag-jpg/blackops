import { normalizeUsername } from "./local-auth-core";
import { validateRequiredRealCliValue } from "./cli-validation";

export type LocalAuthCreateUserOptions = {
  username: string;
  password: string;
  passwordEnv: string;
  printUserId: boolean;
};

export function parseCreateLocalUserArgs(argv: string[]): LocalAuthCreateUserOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };

  return {
    username: normalizeUsername(getValue("--username")),
    password: getValue("--password"),
    passwordEnv: getValue("--password-env"),
    printUserId: argv.includes("--print-user-id"),
  };
}

export function resolveCreateLocalUserOptions(
  options: LocalAuthCreateUserOptions,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): LocalAuthCreateUserOptions {
  if (options.password || !options.passwordEnv) return options;
  return {
    ...options,
    password: env[options.passwordEnv]?.trim() || "",
  };
}

export function validateCreateLocalUserOptions(options: LocalAuthCreateUserOptions): string[] {
  const errors: string[] = [];
  const usernameError = validateRequiredRealCliValue(options.username, "--username");
  const passwordError = validateRequiredRealCliValue(options.password, "--password or --password-env");
  if (usernameError || options.username.length < 2) {
    errors.push("--username is required and must be at least 2 characters.");
  }
  if (!options.password || options.password.length < 8) {
    errors.push("--password or --password-env is required and must resolve to at least 8 characters.");
  } else if (passwordError) {
    errors.push(passwordError);
  }
  return errors;
}
