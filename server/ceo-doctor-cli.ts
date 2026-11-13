export type CeoDoctorOptions = {
  userId: string;
  chatId: string;
  json: boolean;
};

export type CeoDoctorCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

export function hasRealValue(value: string | undefined): value is string {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (/^(replace-|<|your-|tu-|example|changeme|todo)/i.test(normalized)) return false;
  if (/^postgres(?:ql)?:\/\/user:password@host(?::\d+)?\//i.test(normalized)) return false;
  if ([
    "key",
    "api-key",
    "token",
    "bot-token",
    "secret",
    "password",
    "dummy",
    "sample",
    "test",
  ].includes(normalized)) return false;
  return ![
    "your-domain.example",
    "tu-dominio",
    "<real-user-id>",
    "<telegram-chat-id>",
    "postgres://example",
    "postgresql://example",
  ].some((placeholder) => normalized.includes(placeholder));
}

export function hasStrongSecret(value: string | undefined, minLength = 32): boolean {
  return hasRealValue(value) && value.trim().length >= minLength;
}

function isHttpsUrl(value: string | undefined): boolean {
  if (!hasRealValue(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseCeoDoctorArgs(argv: string[]): CeoDoctorOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };

  return {
    userId: getValue("--user-id"),
    chatId: getValue("--chat-id"),
    json: argv.includes("--json"),
  };
}

export function buildCeoDoctorChecks(env: NodeJS.ProcessEnv, options: CeoDoctorOptions): CeoDoctorCheck[] {
  const briefHour = Number(env.CEO_BRIEF_HOUR ?? "7");
  const briefMinute = Number(env.CEO_BRIEF_MINUTE ?? "0");
  const publicUrl = env.TELEGRAM_WEBHOOK_URL || env.PUBLIC_APP_URL;
  const databaseReady = hasRealValue(env.DATABASE_URL);
  const aiReady = hasRealValue(env.AI_INTEGRATIONS_GEMINI_API_KEY);
  const telegramTokenReady = hasRealValue(env.TELEGRAM_BOT_TOKEN);
  const realUserIdReady = hasRealValue(options.userId);
  const realChatIdReady = hasRealValue(options.chatId);
  const defaultUserMatches = realUserIdReady && env.DEFAULT_USER_ID === options.userId;
  const schedulerValid = Boolean(env.SCHEDULER_TIMEZONE)
    && Number.isFinite(briefHour)
    && briefHour >= 0
    && briefHour <= 23
    && Number.isFinite(briefMinute)
    && briefMinute >= 0
    && briefMinute <= 59;

  return [
    {
      id: "database",
      label: "Database",
      ok: databaseReady,
      detail: databaseReady ? "DATABASE_URL configured." : "Set DATABASE_URL to a real production Postgres URL.",
    },
    {
      id: "ai",
      label: "Assistant AI",
      ok: aiReady,
      detail: aiReady ? "AI key configured." : "Set AI_INTEGRATIONS_GEMINI_API_KEY to a real API key for app and Telegram chat.",
    },
    {
      id: "session",
      label: "Session auth",
      ok: hasStrongSecret(env.SESSION_SECRET),
      detail: hasStrongSecret(env.SESSION_SECRET)
        ? "SESSION_SECRET configured with production length."
        : "Set SESSION_SECRET to a real random secret with at least 32 characters.",
    },
    {
      id: "local_auth",
      label: "Local auth",
      ok: env.LOCAL_AUTH_ENABLED === "true",
      detail: env.LOCAL_AUTH_ENABLED === "true" ? "LOCAL_AUTH_ENABLED=true." : "Set LOCAL_AUTH_ENABLED=true unless another auth provider populates req.user/session.",
    },
    {
      id: "dev_fallback",
      label: "Dev fallback",
      ok: env.ALLOW_DEV_USER_FALLBACK === "false",
      detail: env.ALLOW_DEV_USER_FALLBACK === "false" ? "ALLOW_DEV_USER_FALLBACK=false." : "Set ALLOW_DEV_USER_FALLBACK=false before production.",
    },
    {
      id: "telegram_token",
      label: "Telegram token",
      ok: telegramTokenReady,
      detail: telegramTokenReady ? "TELEGRAM_BOT_TOKEN configured." : "Set TELEGRAM_BOT_TOKEN to a real BotFather token.",
    },
    {
      id: "telegram_url",
      label: "Telegram webhook URL",
      ok: isHttpsUrl(publicUrl),
      detail: isHttpsUrl(publicUrl)
        ? "Public HTTPS webhook URL configured."
        : "Set PUBLIC_APP_URL or TELEGRAM_WEBHOOK_URL to a real public HTTPS URL.",
    },
    {
      id: "telegram_secret",
      label: "Telegram webhook secret",
      ok: hasStrongSecret(env.TELEGRAM_WEBHOOK_SECRET, 16),
      detail: hasStrongSecret(env.TELEGRAM_WEBHOOK_SECRET, 16)
        ? "TELEGRAM_WEBHOOK_SECRET configured."
        : "Set TELEGRAM_WEBHOOK_SECRET to a real random secret with at least 16 characters.",
    },
    {
      id: "user_id",
      label: "Real user id",
      ok: realUserIdReady,
      detail: realUserIdReady ? `Using user id ${options.userId}.` : "Set REAL_USER_ID after creating/migrating the user, then pass --user-id=\"$REAL_USER_ID\".",
    },
    {
      id: "default_user",
      label: "System job user",
      ok: defaultUserMatches,
      detail: defaultUserMatches
        ? "DEFAULT_USER_ID matches the checked production user."
        : "Set DEFAULT_USER_ID to the same real user id used by --user-id for single-user system jobs.",
    },
    {
      id: "chat_id",
      label: "Telegram chat id",
      ok: realChatIdReady,
      detail: realChatIdReady ? `Using chat id ${options.chatId}.` : "Set TELEGRAM_CHAT_ID after /start, then pass --chat-id=\"$TELEGRAM_CHAT_ID\".",
    },
    {
      id: "scheduler",
      label: "Morning brief schedule",
      ok: schedulerValid,
      detail: schedulerValid
        ? `Brief scheduled at ${String(briefHour).padStart(2, "0")}:${String(briefMinute).padStart(2, "0")} (${env.SCHEDULER_TIMEZONE}).`
        : "Set SCHEDULER_TIMEZONE, CEO_BRIEF_HOUR 0-23, and CEO_BRIEF_MINUTE 0-59.",
    },
  ];
}

export function buildCeoDoctorNextCommands(options: CeoDoctorOptions): string[] {
  const userId = hasRealValue(options.userId) ? options.userId : "$REAL_USER_ID";
  const chatId = hasRealValue(options.chatId) ? options.chatId : "$TELEGRAM_CHAT_ID";
  return [
    "export LOCAL_AUTH_USERNAME=ceo-admin",
    "export REAL_USER_ID=replace-after-auth-create-user",
    "export TELEGRAM_CHAT_ID=replace-after-telegram-start",
    "export BACKUP_LABEL=$(date +%F)",
    "export BACKUP_DIR=$CEO_BACKUP_DIR/$BACKUP_LABEL",
    "export RESTORE_DATABASE_URL=replace-with-staging-postgres-url",
    "read -r -s LOCAL_AUTH_PASSWORD",
    "export LOCAL_AUTH_PASSWORD",
    "npm run auth:create-user -- --username=\"$LOCAL_AUTH_USERNAME\" --password-env=LOCAL_AUTH_PASSWORD --print-user-id",
    "unset LOCAL_AUTH_PASSWORD",
    `npm run user:migrate -- --from=mock-user-123 --to="${userId}" --execute`,
    `npm run telegram:configure -- --user-id="${userId}" --chat-id="${chatId}" --execute`,
    `npm run telegram:configure -- --user-id="${userId}" --latest --execute`,
    "npm run telegram:webhook -- setup --execute",
    "npm run telegram:webhook -- status",
    "npm run db:push",
    "npm run ceo:db-check -- --json",
    "npm run ceo:backup-check -- --json",
    "npm run ceo:backup -- --label=\"$BACKUP_LABEL\" --execute",
    "RESTORE_DATABASE_URL=\"$RESTORE_DATABASE_URL\" npm run ceo:restore -- --dump=\"$BACKUP_DIR/postgres.dump\" --artifacts=\"$BACKUP_DIR/local-artifacts.tgz\" --manifest=\"$BACKUP_DIR/backup-manifest.json\" --artifacts-output-dir=\"restored-artifacts/$BACKUP_LABEL\" --confirm-restore --execute",
    `npm run ceo:readiness -- --user-id="${userId}"`,
    `npm run ceo:smoke -- --user-id="${userId}" --chat-id="${chatId}"`,
    `npm run ceo:send-brief -- --user-id="${userId}" --execute`,
    `npm run ceo:go-live -- --user-id="${userId}" --chat-id="${chatId}" --confirm-check=backup_executed --note="backup manifest verified" --execute`,
    `npm run ceo:go-live -- --user-id="${userId}" --chat-id="${chatId}" --confirm-check=restore_verified --note="restore probado en staging" --execute`,
    `npm run ceo:go-live -- --user-id="${userId}" --chat-id="${chatId}" --confirm-check=brief_verified --note="brief recibido en Telegram" --execute`,
    `npm run ceo:go-live -- --user-id="${userId}" --chat-id="${chatId}" --confirm-check=telegram_commands_verified --note="comandos Telegram verificados" --execute`,
    `npm run ceo:go-live -- --user-id="${userId}" --chat-id="${chatId}" --confirm-check=conversation_history_verified --note="historial visible en dashboard" --execute`,
    `npm run ceo:go-live -- --user-id="${userId}" --chat-id="${chatId}" --revoke-check=backup_executed --execute`,
    `npm run ceo:go-live -- --user-id="${userId}" --chat-id="${chatId}"`,
    `npm run ceo:go-live -- --user-id="${userId}" --chat-id="${chatId}" --smoke-ready --backup-executed --restore-verified --brief-verified --telegram-commands-verified --conversation-history-verified`,
  ];
}

export function formatCeoDoctorReport(checks: CeoDoctorCheck[], commands: string[]): string {
  const ready = checks.every((check) => check.ok);
  const lines = [
    "CEO Assistant Doctor",
    `Ready: ${ready ? "yes" : "no"}`,
    "",
    ...checks.map((check) => `- [${check.ok ? "ok" : "missing"}] ${check.label}: ${check.detail}`),
    "",
    "Next commands:",
    "Run these in order after replacing placeholder variable values with real values.",
    ...commands.map((command) => `- ${command}`),
  ];
  return lines.join("\n");
}

export function formatCeoDoctorJson(checks: CeoDoctorCheck[], commands: string[]): string {
  return JSON.stringify({
    ready: checks.every((check) => check.ok),
    checks,
    commands,
  }, null, 2);
}
