import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const requiredOperationalScripts = [
  "auth:create-user",
  "user:migrate",
  "telegram:configure",
  "telegram:webhook",
  "ceo:readiness",
  "ceo:send-brief",
  "ceo:smoke",
  "ceo:doctor",
  "ceo:db-check",
  "ceo:backup-check",
  "ceo:backup",
  "ceo:restore",
  "ceo:go-live",
  "ceo:handoff",
  "ceo:verify-local",
  "test:ceo-assistant",
];

const requiredEnvKeys = [
  "DATABASE_URL",
  "AI_INTEGRATIONS_GEMINI_API_KEY",
  "DEFAULT_USER_ID",
  "ALLOW_DEV_USER_FALLBACK",
  "SESSION_SECRET",
  "LOCAL_AUTH_ENABLED",
  "ALLOW_LOCAL_AUTH_REGISTRATION",
  "TELEGRAM_BOT_TOKEN",
  "PUBLIC_APP_URL",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_AUTO_SETUP_WEBHOOK",
  "SCHEDULER_TIMEZONE",
  "CEO_BRIEF_HOUR",
  "CEO_BRIEF_MINUTE",
  "CEO_BACKUP_DIR",
  "CEO_BACKUP_SECRETS_ENCRYPTED",
];

test("CEO Assistant operational scripts exist and are documented", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const runbook = readFileSync("CEO_ASSISTANT_RUNBOOK.md", "utf8");
  const status = readFileSync("CEO_ASSISTANT_STATUS.md", "utf8");

  for (const script of requiredOperationalScripts) {
    assert.equal(typeof packageJson.scripts?.[script], "string", `${script} script should exist`);
    const scriptPattern = new RegExp(`npm run ${script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    assert.match(`${runbook}\n${status}`, scriptPattern, `${script} should be documented`);
  }
});

test("CEO Assistant documented npm commands resolve to package scripts", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const scriptNames = new Set(Object.keys(packageJson.scripts || {}));
  const docs = [
    ["CEO_ASSISTANT_PLAN.md", readFileSync("CEO_ASSISTANT_PLAN.md", "utf8")],
    ["CEO_ASSISTANT_RUNBOOK.md", readFileSync("CEO_ASSISTANT_RUNBOOK.md", "utf8")],
    ["CEO_ASSISTANT_STATUS.md", readFileSync("CEO_ASSISTANT_STATUS.md", "utf8")],
    ["CEO_ASSISTANT_HANDOFF.md", readFileSync("CEO_ASSISTANT_HANDOFF.md", "utf8")],
    ["docs/assistant-stabilization-plan.md", readFileSync("docs/assistant-stabilization-plan.md", "utf8")],
  ] as const;

  for (const [file, source] of docs) {
    for (const match of source.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)) {
      assert.equal(scriptNames.has(match[1]), true, `${file} documents missing npm script ${match[1]}`);
    }
  }
});

test("package scripts point to existing local files", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  for (const [name, command] of Object.entries<string>(packageJson.scripts || {})) {
    const scriptMatches = command.matchAll(/(?:tsx|node --import tsx --test|node --import tsx|node)\s+([^&|;\s]+)/g);
    for (const match of scriptMatches) {
      const filePath = match[1];
      if (!/^[\w./-]+\.(ts|tsx|js|cjs|mjs)$/.test(filePath)) continue;
      if (filePath.startsWith("dist/")) continue;
      assert.doesNotThrow(
        () => readFileSync(filePath, "utf8"),
        `${name} points to missing file ${filePath}`,
      );
    }
  }
});

test("CEO operational scripts avoid direct tsx CLI IPC", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  assert.match(packageJson.scripts?.build || "", /^node --import tsx /, "build should use node --import tsx instead of direct tsx CLI");
  assert.doesNotMatch(packageJson.scripts?.build || "", /^tsx /, "build should avoid direct tsx CLI IPC");

  for (const script of requiredOperationalScripts.filter((name) => !name.startsWith("test:") && !["ceo:handoff", "ceo:verify-local"].includes(name))) {
    assert.match(
      packageJson.scripts?.[script] || "",
      /^node --import tsx /,
      `${script} should use node --import tsx instead of the direct tsx CLI`,
    );
    assert.doesNotMatch(
      packageJson.scripts?.[script] || "",
      /^tsx /,
      `${script} should not use direct tsx because it can fail on IPC-restricted environments`,
    );
  }
});

test("CEO Assistant status tracks runtime-only completion blockers", () => {
  const status = readFileSync("CEO_ASSISTANT_STATUS.md", "utf8");
  const runbook = readFileSync("CEO_ASSISTANT_RUNBOOK.md", "utf8");
  const handoff = readFileSync("CEO_ASSISTANT_HANDOFF.md", "utf8");
  const stabilizationPlan = readFileSync("docs/assistant-stabilization-plan.md", "utf8");

  for (const required of [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "telegram:configure",
    "telegram:webhook",
    "ceo:send-brief",
    "ceo:smoke",
    "ceo:db-check",
    "ceo:backup-check",
    "conversation-history",
    "CEO_ASSISTANT_HANDOFF.md",
    "ceo:verify-local",
  ]) {
    assert.match(status, new RegExp(required), `${required} should be tracked in status`);
  }

  assert.match(runbook, /Handoff seguro de cuentas reales/, "runbook should include an account handoff section");
  assert.doesNotThrow(() => readFileSync("CEO_ASSISTANT_HANDOFF.md", "utf8"), "short handoff checklist should exist");
  assert.match(status, /npm run ceo:handoff/, "status should expose the terminal handoff command");
  assert.match(status, /--user-id="\$REAL_USER_ID" --chat-id="\$TELEGRAM_CHAT_ID"/, "status should use copy-safe production command variables");
  assert.match(status, /--label="\$BACKUP_LABEL"/, "status should use copy-safe backup label variables");
  assert.doesNotMatch(status, /<real-user-id>|<telegram-chat-id>|<staging-db-url>|<backup-dir>|<yyyy-mm-dd>/, "status should not use angle-bracket placeholders in production handoff commands");
  assert.match(stabilizationPlan, /--user-id="\$REAL_USER_ID" --chat-id="\$TELEGRAM_CHAT_ID"/, "stabilization plan should use copy-safe production command variables");
  assert.match(stabilizationPlan, /--label="\$BACKUP_LABEL"/, "stabilization plan should use copy-safe backup label variables");
  assert.doesNotMatch(stabilizationPlan, /<real-user-id>|<telegram-chat-id>|<staging-db-url>|<backup-dir>|<yyyy-mm-dd>|<username>/, "stabilization plan should not use angle-bracket placeholders in production handoff commands");
  assert.match(`${runbook}\n${status}`, /evidencia no sensible/, "handoff docs should warn against storing secrets as evidence");
  for (const checkId of [
    "backup_executed",
    "restore_verified",
    "brief_verified",
    "telegram_commands_verified",
    "conversation_history_verified",
  ]) {
    assert.match(handoff, new RegExp(`--confirm-check=${checkId}`), `handoff should include terminal evidence confirmation for ${checkId}`);
  }
  assert.match(handoff, /--revoke-check=backup_executed/, "handoff should include a terminal evidence revocation example");
  assert.doesNotMatch(handoff, /<real-user-id>|<telegram-chat-id>|<staging-db-url>|<backup-dir>|<yyyy-mm-dd>|<username>/, "handoff commands should use shell variables instead of angle-bracket placeholders");
  assert.match(status, /2026-06-18/, "status should date the latest local verification");
});

test("CEO Assistant root plan tracks the real production handoff gates", () => {
  const plan = readFileSync("CEO_ASSISTANT_PLAN.md", "utf8");

  for (const required of [
    "Handoff de Cuentas Reales",
    "npm run ceo:handoff",
    "REAL_USER_ID",
    "TELEGRAM_CHAT_ID",
    "npm run db:push",
    "ceo:backup",
    "ceo:restore",
    "ceo:smoke",
    "ceo:send-brief",
    "ceo:go-live",
    "POST /api/ceo/go-live/evidence",
    "cuentas reales",
  ]) {
    assert.match(plan, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `root plan should track ${required}`);
  }
  assert.doesNotMatch(plan, /Webhook de Telegram deduplica `update_id` en memoria/, "root plan should not describe persistent Telegram dedupe as memory-only");
  assert.doesNotMatch(plan, /Rate limiting in-memory protege/, "root plan should not describe persistent rate limiting as memory-only");
});

test("CEO Assistant aggregate test includes core safety suites", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const aggregate = packageJson.scripts["test:ceo-assistant"];
  const verifyLocal = packageJson.scripts["ceo:verify-local"];

  assert.match(verifyLocal, /script\/ceo-verify-local\.mjs/, "ceo:verify-local should run the local verification wrapper");

  for (const script of [
    "test:auth",
    "test:local-auth",
    "test:local-auth-cli",
    "test:session",
    "test:db-config",
    "test:env-loader",
    "test:ownership",
    "test:code-agent-security",
    "test:github-client-security",
    "test:developer-autopilot",
    "test:app-qa-agent",
    "test:google-drive-oauth",
    "test:blackroom-links",
    "test:readiness",
    "test:telegram-config-cli",
    "test:telegram-webhook-cli",
    "test:scheduler",
    "test:ceo",
    "test:ceo-db-check-cli",
    "test:ceo-backup-check-cli",
    "test:ceo-go-live-cli",
    "test:ceo-operational-health",
    "test:automation-registry",
    "test:telegram",
    "test:assistant-chat",
    "test:migration",
    "test:conversation",
  ]) {
    assert.match(aggregate, new RegExp(`npm run ${script}`), `${script} should run in test:ceo-assistant`);
  }
});

test("CEO local verification command runs the full no-secret local gate", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const verifyScript = readFileSync("script/ceo-verify-local.mjs", "utf8");
  const status = readFileSync("CEO_ASSISTANT_STATUS.md", "utf8");
  const runbook = readFileSync("CEO_ASSISTANT_RUNBOOK.md", "utf8");
  const handoff = readFileSync("CEO_ASSISTANT_HANDOFF.md", "utf8");

  assert.equal(typeof packageJson.scripts?.["ceo:verify-local"], "string", "ceo:verify-local script should exist");
  for (const required of [
    '"check"',
    '"test:ceo-assistant"',
    '"build"',
    '"ceo:handoff"',
    '"ceo:go-live"',
    '"--smoke-ready"',
    '"--backup-executed"',
    '"--restore-verified"',
    '"--brief-verified"',
    '"--telegram-commands-verified"',
    '"--conversation-history-verified"',
    '"--json"',
  ]) {
    assert.match(verifyScript, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `ceo:verify-local should include ${required}`);
  }
  assert.doesNotMatch(verifyScript, /--execute/, "ceo:verify-local should not execute real external writes");
  assert.match(`${status}\n${runbook}\n${handoff}`, /npm run ceo:verify-local/, "local verification command should be documented");
});

test("scheduler morning brief flow has DB-free integration coverage", () => {
  const schedulerSource = readFileSync("server/reminder-scheduler.ts", "utf8");
  const schedulerTest = readFileSync("tests/reminder-scheduler.test.ts", "utf8");
  const runbook = readFileSync("CEO_ASSISTANT_RUNBOOK.md", "utf8");

  assert.match(schedulerSource, /sendMorningReminderWithDeps/, "scheduler should expose a dependency-injected morning flow");
  assert.match(schedulerSource, /sendEveningReminderWithDeps/, "scheduler should expose a dependency-injected evening flow");
  assert.match(schedulerSource, /sendWeeklyReminderWithDeps/, "scheduler should expose a dependency-injected weekly flow");
  assert.match(schedulerSource, /sendProactiveInsightsWithDeps/, "scheduler should expose dependency-injected proactive insights");
  assert.match(schedulerSource, /runScheduledAgentActionWithDeps/, "scheduler should expose dependency-injected scheduled agent actions");
  assert.match(schedulerSource, /runRadioTemplateGenerationForUserWithDeps/, "scheduler should expose dependency-injected radio template generation");
  assert.match(schedulerSource, /processUserScheduledRemindersWithDeps/, "scheduler should expose dependency-injected user scheduled reminders");
  assert.match(schedulerSource, /sendDailyNewsDigestForUserWithDeps/, "scheduler should expose dependency-injected news digest");
  assert.match(schedulerTest, /runs morning reminder flow for discovered owners with mocked delivery and run records/, "scheduler should test owner discovery, delivery and run records without DB or network");
  assert.match(schedulerTest, /runs evening reminder flow and skips users with no pending tasks/, "scheduler should test evening delivery and skipped runs without DB or network");
  assert.match(schedulerTest, /runs weekly reminder flow and skips users with completed weekly tasks/, "scheduler should test weekly delivery and skipped runs without DB or network");
  assert.match(schedulerTest, /runs proactive insights flow and records sent and skipped outcomes/, "scheduler should test proactive insights without DB or network");
  assert.match(schedulerTest, /runs scheduled agent action flow and records action success and failed results/, "scheduler should test scheduled agent actions without DB or network");
  assert.match(schedulerTest, /records radio template generation runs from generated skipped and failed file totals/, "scheduler should test radio template generation without DB or network");
  assert.match(schedulerTest, /sends due user scheduled reminders once per local date/, "scheduler should test user scheduled reminder delivery and daily dedupe without DB or network");
  assert.match(schedulerTest, /sends daily news digest with top five links and total news count/, "scheduler should test news digest delivery without DB or network");
  assert.match(schedulerTest, /records failed morning reminder runs before surfacing delivery errors/, "scheduler should test failed automation run recording");
  assert.match(schedulerTest, /records failed evening reminder runs before surfacing delivery errors/, "scheduler should test evening failed automation run recording");
  assert.match(schedulerTest, /records failed weekly reminder runs before surfacing delivery errors/, "scheduler should test weekly failed automation run recording");
  assert.match(runbook, /scheduler principal ya tiene pruebas de flujo para morning brief, evening reminder, weekly reminder, proactive insights, radio template generation, agent actions programadas, recordatorios creados por usuario y digest diario de noticias/, "runbook should track scheduler flow coverage");
});

test("scheduler runtime config is read when jobs run", () => {
  const schedulerSource = readFileSync("server/reminder-scheduler.ts", "utf8");
  const schedulerTest = readFileSync("tests/reminder-scheduler.test.ts", "utf8");

  assert.doesNotMatch(schedulerSource, /const SCHEDULER_TIMEZONE = process\.env\.SCHEDULER_TIMEZONE/, "scheduler should not capture timezone at import time");
  assert.doesNotMatch(schedulerSource, /const CEO_BRIEF_HOUR = Number\(process\.env\.CEO_BRIEF_HOUR/, "scheduler should not capture brief hour at import time");
  assert.match(schedulerSource, /getReminderSchedulerConfig\(\)/, "scheduler should resolve runtime schedule config through a helper");
  assert.match(schedulerSource, /parseScheduleNumber/, "scheduler should sanitize schedule hour and minute values");
  assert.match(schedulerTest, /reads scheduler env at runtime and falls back from invalid values/, "scheduler should test runtime env schedule config");
});

test("CEO Assistant docs track single-owner local tool boundaries", () => {
  const status = readFileSync("CEO_ASSISTANT_STATUS.md", "utf8");
  const runbook = readFileSync("CEO_ASSISTANT_RUNBOOK.md", "utf8");
  const plan = readFileSync("docs/assistant-stabilization-plan.md", "utf8");
  const migrationSource = readFileSync("server/user-migration-plan.ts", "utf8");
  const migrationTest = readFileSync("tests/user-migration-plan.test.ts", "utf8");
  const localAuthCliSource = readFileSync("server/local-auth-cli.ts", "utf8");
  const createLocalUserScript = readFileSync("script/create-local-user.ts", "utf8");
  const localAuthCliTest = readFileSync("tests/local-auth-cli.test.ts", "utf8");
  const doctorSource = readFileSync("server/ceo-doctor-cli.ts", "utf8");
  const userContextSource = readFileSync("server/user-context.ts", "utf8");

  for (const source of [status, runbook, plan]) {
    assert.match(source, /DEFAULT_USER_ID/, "single-owner tool docs should mention DEFAULT_USER_ID");
    assert.match(source, /Clippers/, "single-owner tool docs should mention Clippers");
    assert.match(source, /ownerUserId/, "single-owner tool docs should mention ownerUserId audit metadata");
    assert.match(source, /token vault/, "single-owner tool docs should mention token vault boundaries");
  }
  assert.match(migrationSource, /DEFAULT_DEV_USER_ID/, "user migration should know the dev fallback user id");
  assert.match(migrationSource, /cannot be the migration target/, "user migration should reject migrating data back to the dev fallback user");
  assert.match(migrationTest, /cannot be the migration target/, "user migration target guard should have functional coverage");
  assert.match(localAuthCliSource, /passwordEnv/, "local auth CLI should support password env indirection");
  assert.match(createLocalUserScript, /resolveCreateLocalUserOptions/, "create user script should resolve env-sourced passwords");
  assert.match(localAuthCliTest, /resolves create local user password from an env var/, "local auth CLI env password support should have functional coverage");
  assert.match(doctorSource, /--password-env=LOCAL_AUTH_PASSWORD/, "doctor should recommend env-sourced local auth passwords");
  assert.match(doctorSource, /--confirm-check=backup_executed/, "doctor should recommend persisted go-live evidence confirmation from terminal");
  assert.match(doctorSource, /--revoke-check=backup_executed/, "doctor should show how to revoke mistaken go-live evidence from terminal");
  assert.match(runbook, /--password-env=LOCAL_AUTH_PASSWORD/, "runbook should recommend env-sourced local auth passwords");
  assert.match(runbook, /npm run ceo:handoff/, "runbook should point operators to the copy-safe handoff checklist");
  assert.match(runbook, /--user-id="\$REAL_USER_ID" --chat-id="\$TELEGRAM_CHAT_ID" --json/, "runbook should show copy-safe doctor preflight variables");
  assert.match(plan, /--password-env=LOCAL_AUTH_PASSWORD/, "stabilization plan should recommend env-sourced local auth passwords");
  assert.match(doctorSource, /read -r -s LOCAL_AUTH_PASSWORD/, "doctor should recommend reading the local auth password without echoing it");
  assert.match(runbook, /read -r -s LOCAL_AUTH_PASSWORD/, "runbook should recommend reading the local auth password without echoing it");
  assert.match(plan, /read -r -s LOCAL_AUTH_PASSWORD/, "stabilization plan should recommend reading the local auth password without echoing it");
  assert.doesNotMatch(
    `${doctorSource}\n${runbook}\n${plan}`,
    /LOCAL_AUTH_PASSWORD=<password>/,
    "operator guidance should not put the password placeholder in a shell command",
  );
  assert.match(userContextSource, /fallback is only for explicit single-user\s+ \* system jobs and local\/dev data migration/, "system user fallback comment should describe the narrowed production role");
  assert.doesNotMatch(userContextSource, /TODO\(auth\): Route each scheduler, webhook, and integration event/, "system user fallback comment should not preserve stale ownership TODO language");
  assert.doesNotMatch(
    `${doctorSource}\n${runbook}\n${plan}`,
    /auth:create-user -- --username=<username> --password=<password>/,
    "operator guidance should not recommend putting the local auth password directly in the command",
  );
});

test("CEO production scripts reject placeholder env values through shared validation", () => {
  const readinessScript = readFileSync("script/ceo-readiness.ts", "utf8");
  const smokeScript = readFileSync("script/ceo-smoke.ts", "utf8");
  const dbCheckScript = readFileSync("script/ceo-db-check.ts", "utf8");
  const backupCheckScript = readFileSync("script/ceo-backup-check.ts", "utf8");
  const backupCheckSource = readFileSync("server/ceo-backup-check-cli.ts", "utf8");
  const runbook = readFileSync("CEO_ASSISTANT_RUNBOOK.md", "utf8");
  const backupScript = readFileSync("script/ceo-backup.ts", "utf8");
  const restoreScript = readFileSync("script/ceo-restore.ts", "utf8");
  const backupRunSource = readFileSync("server/ceo-backup-run-cli.ts", "utf8");
  const dbSource = readFileSync("server/db.ts", "utf8");
  const databaseUrlSource = readFileSync("server/database-url.ts", "utf8");
  const sessionConfigSource = readFileSync("server/session-config.ts", "utf8");
  const dbTest = readFileSync("tests/db-config.test.ts", "utf8");
  const telegramRoutesSource = readFileSync("server/telegram-routes.ts", "utf8");
  const telegramChatSource = readFileSync("server/telegram-chat.ts", "utf8");
  const localAuthSource = readFileSync("server/local-auth.ts", "utf8");

  for (const source of [readinessScript, smokeScript, backupCheckScript, backupScript, restoreScript, telegramRoutesSource, telegramChatSource, localAuthSource]) {
    assert.match(source, /hasRealValue/, "production scripts should not treat non-empty placeholders as configured");
    assert.doesNotMatch(source, /!process\.env\.DEFAULT_USER_ID/, "DEFAULT_USER_ID placeholder checks should use hasRealValue");
  }

  assert.match(readinessScript, /hasStrongSecret\(process\.env\.SESSION_SECRET\)/, "readiness should require a strong session secret");
  assert.match(readinessScript, /const webhook = hasRealValue\(botToken\) \? await getTelegramWebhookStatus\(\)/, "readiness should not query Telegram webhook status with placeholder bot tokens");
  assert.match(smokeScript, /hasStrongSecret\(process\.env\.TELEGRAM_WEBHOOK_SECRET, 16\)/, "smoke should require a strong webhook secret");
  assert.match(smokeScript, /const webhook = hasRealValue\(botToken\) \? await getTelegramWebhookStatus\(\)/, "smoke should not query Telegram webhook status with placeholder bot tokens");
  assert.match(smokeScript, /hasRealValue\(process\.env\.DATABASE_URL\)\s*\?\s*await getExistingTables\(process\.env\.DATABASE_URL\)/s, "smoke should not connect to placeholder DATABASE_URL values");
  assert.match(smokeScript, /Usage: npm run ceo:smoke -- --user-id=<real-user-id> --chat-id=<telegram-chat-id>/, "smoke usage should require both real user and Telegram chat ids");
  assert.match(readFileSync("server/ceo-smoke-cli.ts", "utf8"), /validateRequiredRealCliValue\(options\.chatId/, "smoke validation should require a real Telegram chat id before production preflight");
  assert.match(dbCheckScript, /hasRealValue\(databaseUrl\)\s*\?\s*await getExistingTables\(databaseUrl\)/s, "DB check should not connect to placeholder DATABASE_URL values");
  assert.match(dbCheckScript, /databaseUrlConfigured: hasRealValue\(databaseUrl\)/, "DB check should reject placeholder DATABASE_URL");
  assert.match(backupCheckScript, /databaseUrlConfigured: hasRealValue\(process\.env\.DATABASE_URL\)/, "backup check should reject placeholder DATABASE_URL");
  assert.match(backupCheckSource, /RESTORE_DATABASE_URL=<staging-db-url> pg_restore/, "backup check restore guidance should use a separate restore database");
  assert.doesNotMatch(backupCheckSource, /pg_restore[^\n]+--dbname="\$DATABASE_URL"/, "backup check should not suggest restoring into production DATABASE_URL");
  assert.match(runbook, /RESTORE_DATABASE_URL="\$RESTORE_DATABASE_URL" pg_restore/, "runbook restore guidance should use the explicit restore database variable");
  assert.doesNotMatch(runbook, /RESTORE_DATABASE_URL=<staging-db-url>/, "runbook copyable restore guidance should avoid placeholder database URLs");
  assert.match(runbook, /nunca contra `DATABASE_URL`/, "runbook should explicitly warn against restoring into production DATABASE_URL");
  assert.match(backupScript, /databaseUrlConfigured: hasRealValue\(process\.env\.DATABASE_URL\)/, "backup run should reject placeholder DATABASE_URL");
  assert.match(restoreScript, /targetDatabaseUrlConfigured: hasRealValue\(targetDatabaseUrl\)/, "restore run should reject placeholder restore DATABASE_URL values");
  assert.match(backupCheckSource, /function resolveCeoBackupDir\(value: string \| undefined\)/, "backup dir resolution should be centralized");
  assert.match(backupCheckScript, /resolveCeoBackupDir\(process\.env\.CEO_BACKUP_DIR\)/, "backup check should reject placeholder backup dirs");
  assert.match(smokeScript, /resolveCeoBackupDir\(process\.env\.CEO_BACKUP_DIR\)/, "smoke should reject placeholder backup dirs");
  assert.match(backupRunSource, /resolveCeoBackupDir\(process\.env\.CEO_BACKUP_DIR\)/, "backup run should reject placeholder backup dirs");
  assert.match(backupRunSource, /Refusing unsafe restore target/, "restore run should refuse production or ambiguous restore targets");
  assert.match(backupRunSource, /RESTORE\|STAGING\|TEST/, "restore run should only allow explicitly non-production target env names");
  assert.match(dbSource, /resolveDatabaseConnectionString/, "database runtime should resolve DATABASE_URL through a tested helper");
  assert.match(databaseUrlSource, /hasRealValue\(env\.DATABASE_URL\)/, "database runtime should reject placeholder DATABASE_URL before creating the pool");
  assert.match(sessionConfigSource, /resolveDatabaseConnectionString/, "session store should use the shared DATABASE_URL resolver");
  assert.match(dbTest, /placeholder DATABASE_URL values/, "database runtime placeholder rejection should have functional coverage");
});

test("radio helper scripts do not accept placeholder external ids", () => {
  const googleDriveSource = readFileSync("server/google-drive.ts", "utf8");
  const ensureRadioFolderScript = readFileSync("script/ensure-radio-tiktok-drive-folder.ts", "utf8");
  const radioVideoEditsScript = readFileSync("script/radio-video-edits.ts", "utf8");
  const radioUploadScript = readFileSync("script/upload-radio-edits-to-drive.ts", "utf8");
  const radioTemplateSource = readFileSync("server/radio-template-agent.ts", "utf8");

  for (const source of [ensureRadioFolderScript, radioVideoEditsScript]) {
    assert.match(source, /hasRealValue\(process\.env\.USER_ID\)/, "radio scripts should reject placeholder USER_ID values");
    assert.doesNotMatch(source, /process\.env\.USER_ID \|\| getSystemUserId\(\)/, "radio scripts should not treat any non-empty USER_ID as real");
  }

  assert.match(radioUploadScript, /resolveDriveFolderId/, "radio upload script should centralize Drive folder id validation");
  assert.match(radioVideoEditsScript, /resolveOptionalPathEnv/, "radio edit script should centralize configurable path validation");
  assert.match(radioVideoEditsScript, /must be a real filesystem path, not a placeholder/, "radio edit script should fail clearly for placeholder path env values");
  assert.match(radioUploadScript, /hasRealValue\(process\.env\.GOOGLE_DRIVE_IG_EDITS_FOLDER_ID\)/, "radio upload should reject placeholder Drive folder ids");
  assert.match(radioUploadScript, /must be a real Google Drive folder id/, "radio upload should fail clearly for placeholder Drive folder ids");
  assert.match(radioUploadScript, /resolveSourceDir/, "radio upload script should centralize upload source path validation");
  assert.match(radioUploadScript, /hasRealValue\(process\.env\.RADIO_EDIT_OUTPUT_DIR\)/, "radio upload should reject placeholder output directories");
  assert.match(googleDriveSource, /readOptionalRealDriveFolderId\("GOOGLE_DRIVE_RADIO_FOLDER_ID"\)/, "Google Drive radio folder env should use shared validation");
  assert.match(googleDriveSource, /hasRealValue\(value\)/, "Google Drive folder env values should reject placeholders");
  assert.doesNotMatch(googleDriveSource, /const configuredRootId = process\.env\.GOOGLE_DRIVE_RADIO_FOLDER_ID/, "Google Drive radio folder should not treat any non-empty env value as real");

  assert.match(radioTemplateSource, /hasRealValue\(configuredBrandTemplateId\)/, "radio template generation should reject placeholder Canva brand template ids");
  assert.match(radioTemplateSource, /CANVA_RADIO_BRAND_TEMPLATE_ID must be a real Canva brand template id/, "radio template generation should fail clearly for placeholder Canva ids");
  assert.match(radioTemplateSource, /function readOptionalRealEnv\(name: string\): string \| null/, "radio template generation should centralize optional env reads");
  assert.match(radioTemplateSource, /readOptionalRealEnv\("CANVA_RADIO_TEMPLATE_EDIT_URL"\)/, "radio template generation should ignore placeholder Canva edit URLs");
  assert.match(radioTemplateSource, /readOptionalRealEnv\("CANVA_RADIO_TEMPLATE_VIEW_URL"\)/, "radio template generation should ignore placeholder Canva view URLs");
});

test("Clippers TikTok public preflight rejects placeholder base URLs", () => {
  const preflightScript = readFileSync("script/clippers-tiktok-preflight.ts", "utf8");

  assert.match(preflightScript, /hasRealValue\(configuredBaseUrl\)/, "TikTok preflight should reject placeholder public base URLs");
  assert.match(preflightScript, /Base URL must be a real public HTTPS URL, not a placeholder/, "TikTok preflight should fail clearly for placeholder public base URLs");
  assert.doesNotMatch(preflightScript, /raw \|\| process\.env\.PUBLIC_BASE_URL \|\| DEFAULT_BASE_URL/, "TikTok preflight should validate configured URLs before falling back to the default");
});

test("Zoho and Finnhub integrations validate runtime credentials", () => {
  const zohoSource = readFileSync("server/zoho-calendar.ts", "utf8");
  const financeSource = readFileSync("server/finance.ts", "utf8");

  assert.doesNotMatch(zohoSource, /const ZOHO_CLIENT_ID = process\.env\.ZOHO_CLIENT_ID/, "Zoho should not capture client id at import time");
  assert.doesNotMatch(zohoSource, /const ZOHO_CLIENT_SECRET = process\.env\.ZOHO_CLIENT_SECRET/, "Zoho should not capture client secret at import time");
  assert.doesNotMatch(zohoSource, /const ZOHO_REFRESH_TOKEN = process\.env\.ZOHO_REFRESH_TOKEN/, "Zoho should not capture refresh token at import time");
  assert.match(zohoSource, /function getZohoCredentials\(\)/, "Zoho should resolve credentials at call time");
  assert.match(zohoSource, /hasRealValue\(process\.env\.ZOHO_CLIENT_ID\)/, "Zoho client id should reject placeholders");
  assert.match(zohoSource, /hasRealValue\(process\.env\.ZOHO_CLIENT_SECRET\)/, "Zoho client secret should reject placeholders");
  assert.match(zohoSource, /hasRealValue\(process\.env\.ZOHO_REFRESH_TOKEN\)/, "Zoho refresh token should reject placeholders");

  assert.match(financeSource, /import \{ hasRealValue \} from "\.\/ceo-doctor-cli"/, "finance integrations should use shared env validation");
  assert.doesNotMatch(financeSource, /if \(!apiKey\)/, "Finnhub should not treat any non-empty token as configured");
  assert.match(financeSource, /if \(!hasRealValue\(apiKey\)\)/, "Finnhub should reject placeholder API keys before fetching");
});

test("Revenue Engine local env overrides reject placeholders", () => {
  const source = readFileSync("server/revenue-engine.ts", "utf8");

  assert.match(source, /function getRevenueEnginePathEnv\(envName: string, defaultFileName: string\)/, "Revenue Engine should centralize JSON path env validation");
  assert.match(source, /configuredPath !== undefined && hasRealValue\(configuredPath\)/, "Revenue Engine JSON path env overrides should reject placeholders");
  assert.match(source, /\[process\.env\.REVENUE_ENGINE_FROM_EMAIL, process\.env\.RESEND_FROM_EMAIL\]\.find\(hasRealValue\)/, "Revenue Engine sender selection should skip placeholder from-email values");
  for (const envName of [
    "REVENUE_ENGINE_LEDGER_PATH",
    "REVENUE_ENGINE_LEADS_PATH",
    "REVENUE_ENGINE_OUTREACH_PATH",
    "REVENUE_ENGINE_AGENT_RUNS_PATH",
    "REVENUE_ENGINE_AUTOMATION_OPPORTUNITIES_PATH",
    "REVENUE_ENGINE_IMPROVEMENT_REVIEWS_PATH",
    "REVENUE_ENGINE_SCOUTING_MISSIONS_PATH",
    "REVENUE_ENGINE_DELIVERY_WORKSPACES_PATH",
    "REVENUE_ENGINE_APPROVAL_DECISIONS_PATH",
    "REVENUE_ENGINE_AUTOMATION_INTAKES_PATH",
  ]) {
    assert.match(source, new RegExp(`getRevenueEnginePathEnv\\("${envName}"`), `${envName} should use shared placeholder-aware path validation`);
  }
});

test("Telegram health and webhook setup reject placeholder env values through shared validation", () => {
  const telegramChatSource = readFileSync("server/telegram-chat.ts", "utf8");
  const telegramRoutesSource = readFileSync("server/telegram-routes.ts", "utf8");
  const indexSource = readFileSync("server/index.ts", "utf8");
  const telegramReadinessSource = readFileSync("server/telegram-readiness.ts", "utf8");
  const telegramHandlerTest = readFileSync("tests/telegram-chat-handler.test.ts", "utf8");
  const reminderSchedulerSource = readFileSync("server/reminder-scheduler.ts", "utf8");
  const telegramConfigureScript = readFileSync("script/configure-telegram.ts", "utf8");
  const telegramWebhookScript = readFileSync("script/telegram-webhook.ts", "utf8");
  const runbook = readFileSync("CEO_ASSISTANT_RUNBOOK.md", "utf8");

  for (const source of [telegramChatSource, telegramWebhookScript]) {
    assert.match(source, /hasStrongSecret\(process\.env\.TELEGRAM_WEBHOOK_SECRET, 16\)/, "Telegram webhook secret should require a real strong value");
  }

  assert.match(telegramChatSource, /tokenReady = hasRealValue\(botToken\)/, "Telegram health should reject placeholder bot tokens");
  assert.match(telegramChatSource, /if \(!hasStrongSecret\(process\.env\.TELEGRAM_WEBHOOK_SECRET, 16\)\)/, "webhook setup should require a real strong secret before registering");
  assert.match(telegramChatSource, /Webhook URL must be a real HTTPS URL/, "webhook setup should reject non-HTTPS public URLs before registering");
  assert.match(indexSource, /process\.env\.TELEGRAM_AUTO_SETUP_WEBHOOK === "true"/, "server startup should not register Telegram webhook unless explicitly enabled");
  assert.match(indexSource, /telegram:webhook -- setup --execute/, "startup log should point operators to explicit webhook setup");
  assert.match(runbook, /TELEGRAM_AUTO_SETUP_WEBHOOK/, "runbook should document webhook auto-setup opt-in");
  assert.match(telegramRoutesSource, /buildTelegramHealthPayload/, "Telegram health route should use the shared readiness payload builder");
  assert.match(telegramRoutesSource, /buildTelegramCeoReadinessPayload/, "CEO readiness route should use the shared readiness payload builder");
  assert.match(telegramReadinessSource, /hasStrongSecret\(input\.webhookSecret, 16\)/, "Telegram readiness payload should require a real strong webhook secret");
  assert.match(telegramReadinessSource, /sessionSecretConfigured: hasStrongSecret\(input\.sessionSecret\)/, "CEO readiness payload should require a strong session secret");
  assert.match(telegramReadinessSource, /aiConfigured = hasRealValue\(input\.aiKey\)/, "Telegram health payload should reject placeholder AI keys");
  assert.match(telegramRoutesSource, /if \(!hasRealValue\(botToken\)\)/, "Telegram configure/test routes should reject placeholder bot tokens");
  assert.match(telegramRoutesSource, /telegram_webhook_secret_invalid/, "Telegram webhook route should fail closed when configured with a weak secret");
  assert.match(telegramChatSource, /if \(!hasRealValue\(deps\.getAiKey\(\)\)\)/, "Telegram chat should reject placeholder AI keys before generating");
  assert.match(telegramChatSource, /handleTelegramMessageWithDeps/, "Telegram chat handler should expose dependency injection for DB-free tests");
  assert.match(telegramHandlerTest, /unknown chats to connect without binding them to a user/, "Telegram chat handler should have a DB-free unknown chat test");
  assert.match(telegramConfigureScript, /if \(!hasRealValue\(botToken\)\)/, "Telegram configure CLI should reject placeholder bot tokens");
  assert.match(reminderSchedulerSource, /if \(!hasRealValue\(botToken\)\) return false/, "scheduled Telegram notifications should reject placeholder bot tokens");
});

test("Telegram delivery modules read and validate bot tokens at send time", () => {
  const deliveryModules = [
    "server/proactive-insights.ts",
    "server/agent-actions.ts",
    "server/market-news.ts",
    "server/health-check.ts",
    "server/portfolio-agent.ts",
    "server/radio-agent.ts",
    "server/radio-video-edit-agent.ts",
    "server/cybersecurity-agent.ts",
  ];

  for (const modulePath of deliveryModules) {
    const source = readFileSync(modulePath, "utf8");
    assert.doesNotMatch(
      source,
      /const TELEGRAM_BOT_TOKEN = process\.env\.TELEGRAM_BOT_TOKEN \|\| ""/,
      `${modulePath} should not capture TELEGRAM_BOT_TOKEN at import time`,
    );
    assert.match(source, /hasRealValue\(token\)/, `${modulePath} should reject placeholder bot tokens`);
    assert.match(source, /getTelegramBotToken\(\)/, `${modulePath} should read the bot token when sending`);
  }
});

test("Gemini clients read and validate API keys at request time", () => {
  const clientSource = readFileSync("server/gemini-client.ts", "utf8");
  const aiModules = [
    "server/code-generator.ts",
    "server/telegram-chat.ts",
    "server/replit_integrations/chat/routes.ts",
    "server/replit_integrations/image/client.ts",
    "server/replit_integrations/image/index.ts",
    "server/replit_integrations/image/routes.ts",
  ];

  assert.match(clientSource, /hasRealValue\(apiKey\)/, "Gemini client should reject placeholder AI keys");
  assert.match(clientSource, /new GoogleGenAI/, "Gemini client should own GoogleGenAI construction");

  for (const modulePath of aiModules) {
    const source = readFileSync(modulePath, "utf8");
    assert.doesNotMatch(
      source,
      /new GoogleGenAI\(\{\s*apiKey: process\.env\.AI_INTEGRATIONS_GEMINI_API_KEY/s,
      `${modulePath} should not construct Gemini clients from env at import time`,
    );
    assert.match(source, /getGeminiClient/, `${modulePath} should use the shared Gemini client helper`);
  }
});

test("OpenAI assistant client reads and validates API keys at request time", () => {
  const clientSource = readFileSync("server/openai-client.ts", "utf8");
  const assistantSource = readFileSync("server/assistant.ts", "utf8");

  assert.match(clientSource, /hasRealValue\(apiKey\)/, "OpenAI client should reject placeholder API keys");
  assert.match(clientSource, /new OpenAI/, "OpenAI client should own OpenAI construction");
  assert.doesNotMatch(
    assistantSource,
    /new OpenAI\(\{\s*apiKey: process\.env\.OPENAI_API_KEY/s,
    "assistant should not construct OpenAI clients from env at import time",
  );
  assert.match(assistantSource, /getOpenAIClient/, "assistant should use the shared OpenAI client helper");
  assert.match(assistantSource, /OPENAI_TRANSCRIPTION_MODEL/, "assistant voice transcription should use the shared OpenAI model config");
});

test("Push notification VAPID keys are validated before use", () => {
  const source = readFileSync("server/push-notifications.ts", "utf8");

  assert.doesNotMatch(
    source,
    /const vapidPublicKey = process\.env\.VAPID_PUBLIC_KEY \|\| ""/,
    "push notifications should not capture VAPID public key at import time",
  );
  assert.doesNotMatch(
    source,
    /if \(vapidPublicKey && vapidPrivateKey\)/,
    "push notifications should not treat any non-empty VAPID keys as configured",
  );
  assert.match(source, /hasRealValue\(publicKey\)/, "push notifications should reject placeholder public keys");
  assert.match(source, /hasRealValue\(privateKey\)/, "push notifications should reject placeholder private keys");
  assert.match(source, /configureWebPush\(\)/, "push notifications should configure VAPID before sending");
});

test("Canva OAuth status and token reads reject placeholder env values", () => {
  const source = readFileSync("server/canva-oauth.ts", "utf8");

  assert.match(source, /import \{ hasRealValue \} from "\.\/ceo-doctor-cli"/, "Canva OAuth should use shared production value validation");
  assert.match(source, /!hasRealValue\(clientId\) \|\| !hasRealValue\(clientSecret\)/, "Canva OAuth client config should reject placeholder client values");
  assert.match(source, /if \(hasRealValue\(process\.env\.CANVA_REDIRECT_URI\)\) return process\.env\.CANVA_REDIRECT_URI/, "Canva redirect URI should reject placeholder values");
  assert.match(source, /\[process\.env\.PUBLIC_APP_URL, process\.env\.EXPO_PUBLIC_DOMAIN\]\.find\(hasRealValue\)/, "Canva public app URL fallback should reject placeholder values");
  assert.match(source, /const scope = hasRealValue\(process\.env\.CANVA_SCOPES\) \? process\.env\.CANVA_SCOPES : DEFAULT_CANVA_SCOPES/, "Canva scopes should reject placeholder values");
  assert.match(source, /if \(hasRealValue\(process\.env\.CANVA_ACCESS_TOKEN\)\) return process\.env\.CANVA_ACCESS_TOKEN/, "Canva env access token should only be used when it is real");
  assert.match(source, /envTokenConfigured = hasRealValue\(process\.env\.CANVA_ACCESS_TOKEN\)/, "Canva status should reject placeholder env tokens");
  assert.match(source, /redirectUri: hasRealValue\(process\.env\.CANVA_REDIRECT_URI\) \? process\.env\.CANVA_REDIRECT_URI : null/, "Canva status should not expose placeholder redirect URIs as configured");
  assert.doesNotMatch(source, /configured: Boolean\(process\.env\.CANVA_ACCESS_TOKEN/, "Canva status should not treat any non-empty env value as configured");
});

test("CEO Assistant env example covers runbook critical variables", () => {
  const envExample = readFileSync("CEO_ASSISTANT_ENV.example", "utf8");
  const runbook = readFileSync("CEO_ASSISTANT_RUNBOOK.md", "utf8");

  for (const key of requiredEnvKeys) {
    assert.match(envExample, new RegExp(`^#?\\s*${key}=`, "m"), `${key} should exist in env example`);
    assert.match(runbook, new RegExp(`\`${key}\``), `${key} should be documented in runbook`);
  }
  assert.match(
    envExample,
    /^DATABASE_URL=replace-with-production-postgres-url$/m,
    "DATABASE_URL example should be an obvious placeholder rejected by preflight",
  );
  assert.match(
    envExample,
    /CEO_ASSISTANT_ENV, \.env, \.env\.local, credentials\/ and secrets\/\s*\n# are covered by encrypted off-machine backup\./,
    "env example should describe the full sensitive backup scope",
  );
});

test("CEO operational CLIs load local env files before reading process env", () => {
  const cliScripts = [
    "script/ceo-doctor.ts",
    "script/ceo-readiness.ts",
    "script/ceo-smoke.ts",
    "script/ceo-db-check.ts",
    "script/ceo-backup-check.ts",
    "script/ceo-backup.ts",
    "script/ceo-restore.ts",
    "script/ceo-go-live.ts",
    "script/configure-telegram.ts",
    "script/telegram-webhook.ts",
    "script/send-ceo-brief.ts",
    "script/create-local-user.ts",
    "script/migrate-user.ts",
  ];

  for (const scriptPath of cliScripts) {
    const source = readFileSync(scriptPath, "utf8");
    assert.match(source, /import "\.\.\/server\/env-loader";/, `${scriptPath} should load local env files`);
    assert.equal(source.indexOf('import "../server/env-loader";'), 0, `${scriptPath} should load env before other imports`);
  }
});

test("local generated artifact directories are ignored by git and covered by backup policy", () => {
  const gitignore = readFileSync(".gitignore", "utf8");
  const backupSource = readFileSync("server/ceo-backup-check-cli.ts", "utf8");

  for (const pattern of [
    ".env",
    ".env.local",
    "CEO_ASSISTANT_ENV",
    "* 2.*",
    ".cache",
    "credentials/*",
    "secrets/*",
    "backups/*",
    ".backups/*",
    "radio_video_edits/01_originales/*",
    "radio_video_edits/03_listos_para_subir/*",
    "radio_video_edits/04_reportes/*",
    "promo_video_edits/01_originales/*",
    "promo_video_edits/03_listos_para_subir/*",
    "promo_video_edits/04_reportes/*",
    "clippers_workspace/*",
    "revenue_engine_data/*",
    "revenue_mockups/*",
  ]) {
    assert.match(gitignore, new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${pattern} should be ignored`);
  }

  assert.match(backupSource, /DEFAULT_CEO_BACKUP_DIR = "backups\/ceo-assistant"/, "default CEO backup dir should stay under ignored backups/");

  for (const artifactPath of [
    "radio_video_edits",
    "promo_video_edits",
    "clippers_workspace",
    "revenue_engine_data",
    "revenue_mockups",
    "CEO_ASSISTANT_ENV",
    ".env",
    ".env.local",
    "credentials",
    "secrets",
  ]) {
    assert.match(backupSource, new RegExp(artifactPath), `${artifactPath} should be included in backup policy`);
  }
  assert.match(backupSource, /CEO_ASSISTANT_ENV", sensitive: true, policy: "encrypted_only"/, "CEO assistant env file should require encrypted off-machine backup");
  assert.match(backupSource, /\.env", sensitive: true, policy: "encrypted_only"/, ".env should require encrypted off-machine backup");
});

test("Telegram and CEO readiness routes are registered through a domain module", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");
  const telegramRoutesSource = readFileSync("server/telegram-routes.ts", "utf8");

  assert.match(routesSource, /registerTelegramRoutes\(app\)/, "routes.ts should delegate Telegram routes to the domain module");
  assert.doesNotMatch(routesSource, /api\/telegram\/webhook/, "routes.ts should not inline Telegram webhook behavior");
  assert.match(telegramRoutesSource, /api\/telegram\/webhook/, "telegram-routes should own the Telegram webhook endpoint");
  assert.match(telegramRoutesSource, /api\/ceo\/readiness/, "telegram-routes should own CEO readiness wiring that depends on Telegram health");
});

test("CEO dashboard memory mutations verify authenticated ownership before mutating by id", () => {
  const routesSource = readFileSync("server/routes.ts", "utf8");

  assert.match(routesSource, /async function deleteCeoMemoryItem\(req: any, res: any, category: "decision" \| "person" \| "commitment"\)/, "CEO memory delete should use a shared owner-scoped helper");
  assert.match(routesSource, /async function updateCeoMemoryItem\(req: any, res: any, category: "decision" \| "person" \| "commitment"\)/, "CEO memory update should use a shared owner-scoped helper");
  assert.match(routesSource, /const userId = getCurrentUserId\(req\);\s*const items = await storage\.getUserProfileDataByCategory\(userId, category\);\s*const item = items\.find\(\(entry\) => entry\.id === req\.params\.id\);/s, "CEO memory helpers should resolve records from the authenticated user's category before mutating");
  assert.match(routesSource, /if \(!item\) \{\s*return res\.status\(404\)\.json\(\{ error: "Memory item not found" \}\);\s*\}/s, "CEO memory helpers should hide records that do not belong to the authenticated user");
  assert.match(routesSource, /await storage\.deleteUserProfileData\(item\.id\)/, "CEO memory delete should only delete the owner-scoped item id");
  assert.match(routesSource, /await storage\.updateUserProfileData\(item\.id,/, "CEO memory update should only update the owner-scoped item id");
  assert.doesNotMatch(routesSource, /storage\.deleteUserProfileData\(req\.params\.id\)/, "CEO memory delete should not delete arbitrary ids from route params");
  assert.doesNotMatch(routesSource, /storage\.updateUserProfileData\(req\.params\.id/, "CEO memory update should not update arbitrary ids from route params");
  assert.match(routesSource, /const task = await storage\.getTask\(req\.params\.id\);\s*if \(!task \|\| task\.userId !== userId \|\| task\.type !== "follow_up"\)/s, "CEO follow-up completion should verify owner and task type before mutation");
});

test("CEO go-live gate is exposed through CLI and API wiring", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const goLiveSource = readFileSync("server/ceo-go-live-cli.ts", "utf8");
  const goLiveScript = readFileSync("script/ceo-go-live.ts", "utf8");
  const smokeScript = readFileSync("script/ceo-smoke.ts", "utf8");
  const goLiveTest = readFileSync("tests/ceo-go-live-cli.test.ts", "utf8");
  const routesSource = readFileSync("server/telegram-routes.ts", "utf8");
  const dashboardSource = readFileSync("client/src/pages/ceo-dashboard.tsx", "utf8");
  const runbook = readFileSync("CEO_ASSISTANT_RUNBOOK.md", "utf8");
  const status = readFileSync("CEO_ASSISTANT_STATUS.md", "utf8");

  assert.equal(typeof packageJson.scripts?.["ceo:go-live"], "string", "ceo:go-live script should exist");
  assert.equal(typeof packageJson.scripts?.["test:ceo-go-live-cli"], "string", "ceo go-live CLI tests should exist");
  assert.match(goLiveSource, /buildCeoGoLiveEvidenceFlags/, "go-live evidence flag mapping should live with the gate builder");
  assert.match(goLiveSource, /buildCeoGoLiveEvidenceMeta/, "go-live evidence metadata mapping should live with the gate builder");
  assert.match(goLiveScript, /storage\.getUserProfileDataByCategory\(userId, CEO_GO_LIVE_EVIDENCE_CATEGORY\)/, "ceo:go-live should read persisted evidence by user");
  assert.match(goLiveScript, /hasRealValue\(process\.env\.DATABASE_URL\)/, "ceo:go-live should check DATABASE_URL before reading persisted evidence");
  assert.match(goLiveScript, /await import\("\.\.\/server\/storage"\)/, "ceo:go-live should import storage only after DATABASE_URL is real");
  assert.match(goLiveScript, /buildCeoGoLiveEvidenceFlags/, "ceo:go-live should merge persisted evidence flags");
  assert.match(goLiveScript, /using CLI flags only/, "ceo:go-live should fall back to explicit CLI flags if persisted evidence cannot be read");
  assert.match(goLiveSource, /CEO_GO_LIVE_MANUAL_EVIDENCE_CHECK_IDS/, "go-live should define which checks allow manual persisted evidence");
  assert.match(goLiveSource, /isCeoGoLiveManualEvidenceCheckId\(checkId\)/, "go-live evidence mutation should reject automatic checks such as smoke");
  assert.match(goLiveSource, /buildCeoGoLiveSmokeEvidenceMutation/, "go-live should expose an automatic smoke evidence mutation for ceo:smoke");
  assert.match(goLiveScript, /--confirm-check=<check-id>/, "ceo:go-live usage should document terminal evidence confirmation");
  assert.match(goLiveScript, /--revoke-check=<check-id>/, "ceo:go-live usage should document terminal evidence revocation");
  assert.match(goLiveScript, /buildCeoGoLiveEvidenceMutation/, "ceo:go-live should persist or revoke manual evidence through the shared mutation builder");
  assert.match(goLiveScript, /saveUserProfileData/, "ceo:go-live should persist manual evidence per user when explicitly executed");
  assert.match(goLiveScript, /deleteUserProfileData/, "ceo:go-live should revoke manual evidence per user when explicitly executed");
  assert.match(smokeScript, /buildCeoGoLiveSmokeEvidenceMutation/, "ceo:smoke should persist automatic smoke evidence after a successful run");
  assert.match(smokeScript, /CEO_GO_LIVE_EVIDENCE_CATEGORY/, "ceo:smoke should persist smoke evidence in the go-live evidence namespace");
  assert.match(goLiveTest, /builds go-live readiness flags from persisted evidence keys/, "go-live evidence flag mapping should have functional coverage");
  assert.match(goLiveTest, /automatic smoke evidence/, "automatic smoke evidence should have functional coverage");
  assert.match(goLiveTest, /builds go-live evidence metadata from persisted values/, "go-live evidence metadata should have functional coverage");
  assert.match(goLiveTest, /must be verified by its command/, "go-live smoke check should not be manually confirmable");
  assert.match(goLiveTest, /runtime-flag/, "go-live runtime flags should be labeled separately from persisted evidence");
  assert.match(`${runbook}\n${status}`, /runtime-flag/, "go-live docs should label temporary flags separately from persisted evidence");
  assert.match(`${runbook}\n${status}`, /POST \/api\/ceo\/go-live\/evidence/, "go-live docs should point to persisted evidence confirmation");
  assert.match(`${runbook}\n${status}`, /--confirm-check=<check-id>/, "go-live docs should document terminal evidence confirmation");
  assert.match(`${runbook}\n${status}`, /--revoke-check=<check-id>/, "go-live docs should document terminal evidence revocation");
  for (const checkId of [
    "backup_executed",
    "restore_verified",
    "brief_verified",
    "telegram_commands_verified",
    "conversation_history_verified",
  ]) {
    assert.match(runbook, new RegExp(`--confirm-check=${checkId}`), `runbook should include terminal evidence confirmation for ${checkId}`);
  }
  assert.match(goLiveTest, /validates go-live check ids and manual evidence boundaries before persistence/, "go-live check id validation should have functional coverage");
  assert.match(routesSource, /api\/ceo\/go-live/, "telegram-routes should expose the CEO go-live gate");
  assert.match(routesSource, /buildCeoGoLiveReport/, "CEO go-live route should use the shared gate builder");
  assert.match(routesSource, /const userId = getCurrentUserId\(req\)/, "CEO go-live route should use the authenticated owner");
  assert.doesNotMatch(routesSource, /req\.query\.userId/, "CEO go-live route should not allow query-string user impersonation");
  assert.doesNotMatch(routesSource, /req\.query\.chatId/, "CEO go-live route should not allow query-string chat id overrides");
  assert.doesNotMatch(routesSource, /readBooleanFlag\(req, "smokeReady"\)/, "CEO go-live API should not accept query flags that mark smoke ready");
  assert.doesNotMatch(routesSource, /readBooleanFlag\(req, "backupExecuted"\)/, "CEO go-live API should not accept query flags that mark external evidence ready");
  assert.match(`${runbook}\n${status}`, /API\/dashboard leen evidencia persistida|No acepta flags query/, "go-live docs should say API/dashboard use persisted evidence, not URL flags");
  assert.match(routesSource, /api\/ceo\/go-live\/evidence/, "telegram-routes should persist go-live evidence confirmations");
  assert.match(routesSource, /note: req\.body\?\.note/, "go-live evidence API should accept optional non-sensitive notes");
  assert.match(routesSource, /CEO_GO_LIVE_EVIDENCE_CATEGORY/, "go-live evidence should be namespaced");
  assert.match(routesSource, /buildCeoGoLiveEvidenceMutation/, "go-live evidence route should use the shared mutation builder");
  assert.match(routesSource, /parseCeoGoLiveEvidenceConfirmation/, "go-live evidence should parse explicit true and false confirmations");
  assert.match(goLiveTest, /requires explicit go-live evidence confirmation values/, "go-live evidence confirmation parsing should have functional coverage");
  assert.match(goLiveTest, /without destructive defaults/, "go-live evidence mutations should reject invalid input without save or delete actions");
  assert.match(goLiveSource, /confirmed=true\|false is required/, "go-live evidence should reject missing confirmation values");
  assert.match(goLiveSource, /sanitizeCeoGoLiveEvidenceNote/, "go-live evidence notes should be sanitized before persistence");
  assert.match(routesSource, /saveUserProfileData/, "go-live evidence should be stored per user without adding secret material");
  assert.match(routesSource, /deleteUserProfileData/, "go-live evidence should be reversible if confirmed by mistake");
  assert.match(dashboardSource, /api\/ceo\/go-live/, "CEO dashboard should read the go-live gate");
  assert.match(dashboardSource, /api\/ceo\/go-live\/evidence/, "CEO dashboard should let the operator confirm external evidence");
  assert.match(dashboardSource, /type CeoGoLive/, "CEO dashboard should type the go-live report");
  assert.match(dashboardSource, /title="Go-live"/, "CEO dashboard should surface go-live status");
  assert.match(dashboardSource, /nextCommands/, "CEO dashboard should show next evidence commands");
  assert.doesNotMatch(dashboardSource, /missingGoLiveChecks\.slice/, "CEO dashboard should show every missing go-live check");
  assert.doesNotMatch(dashboardSource, /nextCommands\.slice/, "CEO dashboard should show every go-live evidence command");
  assert.doesNotMatch(dashboardSource, /confirmedGoLiveChecks\.slice/, "CEO dashboard should show every confirmed go-live check");
  assert.match(dashboardSource, /navigator\.clipboard\.writeText/, "CEO dashboard should let the operator copy go-live evidence commands");
  assert.match(dashboardSource, /copyGoLiveCommandError/, "CEO dashboard should show copy failures instead of a false success");
  assert.match(dashboardSource, /catch \{/, "CEO dashboard should handle clipboard permission failures");
  assert.doesNotMatch(dashboardSource, /exec\(|spawn\(|child_process/, "CEO dashboard should not execute go-live evidence commands");
  assert.match(dashboardSource, /Confirmar/, "CEO dashboard should show a confirmation action for missing evidence");
  assert.match(dashboardSource, /canManuallyConfirmGoLiveCheck\(check\.id\)/, "CEO dashboard should not show manual confirmation for automatic go-live checks");
  assert.match(dashboardSource, /comando de smoke/, "CEO dashboard should tell the operator to run smoke instead of manually confirming it");
  assert.match(dashboardSource, /Reset/, "CEO dashboard should let the operator reset confirmed evidence");
  assert.match(
    dashboardSource,
    /canManuallyConfirmGoLiveCheck\(check\.id\) \? \(\s*<Button[\s\S]*Reset[\s\S]*\) : \(\s*<p className="shrink-0 text-\[11px\] text-cyan-300">comando<\/p>/,
    "CEO dashboard should not reset automatic smoke evidence manually",
  );
  assert.match(dashboardSource, /confirmedAt/, "CEO dashboard should show persisted evidence timestamps when available");
  assert.match(dashboardSource, /check\.evidence\?\.note/, "CEO dashboard should show optional go-live evidence notes");
  assert.match(runbook, /note` opcional de maximo 240 caracteres/, "go-live runbook should document optional non-sensitive evidence notes");
  assert.match(`${runbook}\n${status}`, /npm run ceo:go-live/, "go-live gate should be documented");
});

test("Clippers developer app connection kit exposes missing state safely in the UI", () => {
  const dashboardSource = readFileSync("client/src/pages/clippers.tsx", "utf8");

  assert.match(
    dashboardSource,
    /function developerAppEvidenceBadge\(status: ClipperDeveloperAppEvidenceStatus \| ClipperDeveloperAppEvidenceItemStatus \| "missing"\)/,
    "developer app connection kit badges should accept missing platform evidence",
  );
  assert.match(
    dashboardSource,
    /connectionKitItems\.map\(\(item\) => \(/,
    "Clippers UI should render developer app connection kit platform rows",
  );
});
