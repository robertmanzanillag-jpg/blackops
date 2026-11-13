import assert from "node:assert/strict";
import test from "node:test";
import { buildCeoDoctorChecks, buildCeoDoctorNextCommands, formatCeoDoctorJson, formatCeoDoctorReport, hasRealValue, hasStrongSecret, parseCeoDoctorArgs } from "../server/ceo-doctor-cli";

test("parses CEO doctor CLI options", () => {
  assert.deepEqual(parseCeoDoctorArgs(["--user-id=user-123", "--chat-id=999", "--json"]), {
    userId: "user-123",
    chatId: "999",
    json: true,
  });
});

test("detects placeholder production values even when they look syntactically valid", () => {
  assert.equal(hasRealValue("https://your-domain.example"), false);
  assert.equal(hasRealValue("postgres://user:password@host:5432/blackops"), false);
  assert.equal(hasRealValue("postgres://example"), false);
  assert.equal(hasRealValue("postgres://ceo_user:real-pass@db.internal:5432/blackops"), true);
  assert.equal(hasRealValue("key"), false);
  assert.equal(hasRealValue("token"), false);
  assert.equal(hasRealValue("secret"), false);
  assert.equal(hasRealValue("password"), false);
  assert.equal(hasRealValue("replace-with-secret"), false);
  assert.equal(hasRealValue("<real-user-id>"), false);
  assert.equal(hasStrongSecret("replace-with-long-random-secret"), false);
  assert.equal(hasStrongSecret("real-random-secret-value-with-32-plus-chars"), true);
});

test("builds CEO doctor checks from env and options", () => {
  const checks = buildCeoDoctorChecks({
    DATABASE_URL: "postgres://ceo_user:real-pass@db.internal:5432/blackops",
    AI_INTEGRATIONS_GEMINI_API_KEY: "AIza-real-looking-key",
    SESSION_SECRET: "a-production-session-secret-32-chars",
    LOCAL_AUTH_ENABLED: "true",
    ALLOW_DEV_USER_FALLBACK: "false",
    TELEGRAM_BOT_TOKEN: "1234567890:real-bot-token-value",
    PUBLIC_APP_URL: "https://app.blackroomus.com",
    TELEGRAM_WEBHOOK_SECRET: "telegram-secret-16",
    DEFAULT_USER_ID: "user-123",
    SCHEDULER_TIMEZONE: "America/New_York",
    CEO_BRIEF_HOUR: "7",
    CEO_BRIEF_MINUTE: "0",
  } as NodeJS.ProcessEnv, {
    userId: "user-123",
    chatId: "999",
  });

  assert.equal(checks.every((check) => check.ok), true);
});

test("flags unsafe production auth and scheduler settings", () => {
  const checks = buildCeoDoctorChecks({
    DATABASE_URL: "postgres://ceo_user:real-pass@db.internal:5432/blackops",
    AI_INTEGRATIONS_GEMINI_API_KEY: "AIza-real-looking-key",
    SESSION_SECRET: "short",
    LOCAL_AUTH_ENABLED: "false",
    ALLOW_DEV_USER_FALLBACK: "true",
    TELEGRAM_BOT_TOKEN: "1234567890:real-bot-token-value",
    PUBLIC_APP_URL: "http://example.com",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    DEFAULT_USER_ID: "another-user",
    SCHEDULER_TIMEZONE: "",
    CEO_BRIEF_HOUR: "99",
    CEO_BRIEF_MINUTE: "0",
  } as NodeJS.ProcessEnv, {
    userId: "user-123",
    chatId: "999",
  });

  assert.equal(checks.find((check) => check.id === "local_auth")?.ok, false);
  assert.equal(checks.find((check) => check.id === "dev_fallback")?.ok, false);
  assert.equal(checks.find((check) => check.id === "session")?.ok, false);
  assert.equal(checks.find((check) => check.id === "telegram_url")?.ok, false);
  assert.equal(checks.find((check) => check.id === "telegram_secret")?.ok, false);
  assert.equal(checks.find((check) => check.id === "default_user")?.ok, false);
  assert.equal(checks.find((check) => check.id === "scheduler")?.ok, false);
});

test("flags placeholder production values", () => {
  const checks = buildCeoDoctorChecks({
    DATABASE_URL: "replace-with-database-url",
    AI_INTEGRATIONS_GEMINI_API_KEY: "replace-with-gemini-api-key",
    SESSION_SECRET: "replace-with-long-random-secret",
    LOCAL_AUTH_ENABLED: "true",
    ALLOW_DEV_USER_FALLBACK: "false",
    TELEGRAM_BOT_TOKEN: "replace-with-botfather-token",
    PUBLIC_APP_URL: "https://your-domain.example",
    TELEGRAM_WEBHOOK_SECRET: "replace-with-telegram-webhook-secret",
    DEFAULT_USER_ID: "replace-after-running-auth-create-user",
    SCHEDULER_TIMEZONE: "America/New_York",
    CEO_BRIEF_HOUR: "7",
    CEO_BRIEF_MINUTE: "0",
  } as NodeJS.ProcessEnv, {
    userId: "user-123",
    chatId: "999",
  });

  assert.equal(checks.find((check) => check.id === "database")?.ok, false);
  assert.equal(checks.find((check) => check.id === "ai")?.ok, false);
  assert.equal(checks.find((check) => check.id === "session")?.ok, false);
  assert.equal(checks.find((check) => check.id === "telegram_token")?.ok, false);
  assert.equal(checks.find((check) => check.id === "telegram_url")?.ok, false);
  assert.equal(checks.find((check) => check.id === "telegram_secret")?.ok, false);
  assert.equal(checks.find((check) => check.id === "default_user")?.ok, false);
  assert.doesNotMatch(checks.find((check) => check.id === "database")?.detail || "", /configured/i);
  assert.doesNotMatch(checks.find((check) => check.id === "ai")?.detail || "", /configured/i);
  assert.doesNotMatch(checks.find((check) => check.id === "telegram_token")?.detail || "", /configured/i);
});

test("flags placeholder CLI ids and keeps next commands as examples", () => {
  const checks = buildCeoDoctorChecks({
    DATABASE_URL: "postgres://ceo_user:real-pass@db.internal:5432/blackops",
    AI_INTEGRATIONS_GEMINI_API_KEY: "AIza-real-looking-key",
    SESSION_SECRET: "a-production-session-secret-32-chars",
    LOCAL_AUTH_ENABLED: "true",
    ALLOW_DEV_USER_FALLBACK: "false",
    TELEGRAM_BOT_TOKEN: "1234567890:real-bot-token-value",
    PUBLIC_APP_URL: "https://app.blackroomus.com",
    TELEGRAM_WEBHOOK_SECRET: "telegram-secret-16",
    DEFAULT_USER_ID: "<real-user-id>",
    SCHEDULER_TIMEZONE: "America/New_York",
    CEO_BRIEF_HOUR: "7",
    CEO_BRIEF_MINUTE: "0",
  } as NodeJS.ProcessEnv, {
    userId: "<real-user-id>",
    chatId: "<telegram-chat-id>",
  });

  assert.equal(checks.find((check) => check.id === "user_id")?.ok, false);
  assert.equal(checks.find((check) => check.id === "chat_id")?.ok, false);
  assert.equal(checks.find((check) => check.id === "default_user")?.ok, false);

  const commands = buildCeoDoctorNextCommands({ userId: "<real-user-id>", chatId: "<telegram-chat-id>", json: false });
  assert.ok(commands.some((command) => command.includes("--to=\"$REAL_USER_ID\"")));
  assert.ok(commands.some((command) => command.includes("--chat-id=\"$TELEGRAM_CHAT_ID\"")));
});

test("prints next CEO doctor commands with placeholders", () => {
  const commands = buildCeoDoctorNextCommands({ userId: "", chatId: "", json: false });
  assert.ok(commands.some((command) => command === "export REAL_USER_ID=replace-after-auth-create-user"));
  assert.ok(commands.some((command) => command === "export TELEGRAM_CHAT_ID=replace-after-telegram-start"));
  assert.ok(commands.some((command) => command === "export BACKUP_LABEL=$(date +%F)"));
  assert.ok(commands.some((command) => command === "npm run telegram:webhook -- status"));
  assert.ok(commands.some((command) => command === "npm run db:push"));
  assert.ok(commands.some((command) => command.includes("npm run ceo:backup -- --label=\"$BACKUP_LABEL\" --execute")));
  assert.ok(commands.some((command) => command.includes("RESTORE_DATABASE_URL=\"$RESTORE_DATABASE_URL\" npm run ceo:restore")));
  assert.ok(commands.some((command) => command.includes("--artifacts=\"$BACKUP_DIR/local-artifacts.tgz\"")));
  assert.ok(commands.some((command) => command.includes("--manifest=\"$BACKUP_DIR/backup-manifest.json\"")));
  assert.ok(commands.some((command) => command.includes("npm run ceo:go-live -- --user-id=\"$REAL_USER_ID\" --chat-id=\"$TELEGRAM_CHAT_ID\"")));
  assert.ok(commands.some((command) => command.includes("--confirm-check=backup_executed")));
  assert.ok(commands.some((command) => command.includes("--confirm-check=restore_verified")));
  assert.ok(commands.some((command) => command.includes("--confirm-check=brief_verified")));
  assert.ok(commands.some((command) => command.includes("--confirm-check=telegram_commands_verified")));
  assert.ok(commands.some((command) => command.includes("--confirm-check=conversation_history_verified")));
  assert.ok(commands.some((command) => command.includes("--revoke-check=backup_executed")));
  assert.ok(commands.some((command) => command.includes("--smoke-ready --backup-executed --restore-verified --brief-verified --telegram-commands-verified --conversation-history-verified")));
  assert.doesNotMatch(commands.join("\n"), /<[^>]+>/, "doctor next commands should not print angle-bracket placeholders that zsh treats as redirection");

  const report = formatCeoDoctorReport([], commands);
  assert.match(report, /CEO Assistant Doctor/);
  assert.match(report, /Ready: yes/);
  assert.match(report, /Next commands:/);
  assert.match(report, /Run these in order after replacing placeholder variable values with real values\./);
});

test("prints CEO doctor JSON for automated preflight gates", () => {
  const checks = [
    { id: "ai", label: "Assistant AI", ok: true, detail: "AI key configured." },
    { id: "telegram_token", label: "Telegram token", ok: false, detail: "Set TELEGRAM_BOT_TOKEN." },
  ];
  const output = JSON.parse(formatCeoDoctorJson(checks, ["npm run ceo:doctor"]));

  assert.equal(output.ready, false);
  assert.equal(output.checks.length, 2);
  assert.deepEqual(output.commands, ["npm run ceo:doctor"]);
});
