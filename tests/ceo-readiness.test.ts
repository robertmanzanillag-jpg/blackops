import assert from "node:assert/strict";
import test from "node:test";
import { buildCeoReadinessReport, type CeoReadinessInput } from "../server/ceo-readiness";

function readyInput(overrides: Partial<CeoReadinessInput> = {}): CeoReadinessInput {
  return {
    auth: {
      userId: "user-1",
      devFallbackAllowed: false,
      usingDevFallback: false,
      defaultUserConfigured: true,
      sessionSecretConfigured: true,
      sessionStoreKind: "postgres",
      ...overrides.auth,
    },
    assistant: {
      aiConfigured: true,
      ...overrides.assistant,
    },
    telegram: {
      tokenConfigured: true,
      chatConfigured: true,
      enabled: true,
      webhookUrlConfigured: true,
      webhookRegistered: true,
      webhookMatchesExpected: true,
      webhookSecretConfigured: true,
      lastWebhookError: null,
      ...overrides.telegram,
    },
    scheduler: {
      timezone: "America/New_York",
      ceoBriefHour: 7,
      ceoBriefMinute: 0,
      ...overrides.scheduler,
    },
  };
}

test("reports CEO Assistant ready when auth, Telegram, webhook, and scheduler are ready", () => {
  const report = buildCeoReadinessReport(readyInput());

  assert.equal(report.ready, true);
  assert.equal(report.status, "ready");
  assert.equal(report.checks.every((check) => check.status === "ready"), true);
});

test("warns when using dev auth fallback or missing webhook secret", () => {
  const report = buildCeoReadinessReport(readyInput({
    auth: { userId: "mock-user-123", usingDevFallback: true, devFallbackAllowed: true, defaultUserConfigured: false, sessionSecretConfigured: false, sessionStoreKind: "memory" },
    telegram: { webhookSecretConfigured: false },
  }));

  assert.equal(report.ready, false);
  assert.equal(report.status, "warning");
  assert.equal(report.checks.some((check) => check.id === "auth" && check.status === "warning"), true);
  assert.equal(report.checks.some((check) => check.id === "session_secret" && check.status === "warning"), true);
  assert.equal(report.checks.some((check) => check.id === "session_store" && check.status === "warning"), true);
  assert.equal(report.checks.some((check) => check.id === "telegram_webhook_secret" && check.status === "warning"), true);
});

test("blocks readiness when session middleware is disabled", () => {
  const report = buildCeoReadinessReport(readyInput({
    auth: { sessionSecretConfigured: false, sessionStoreKind: "disabled" },
  }));

  assert.equal(report.ready, false);
  assert.equal(report.status, "blocked");
  assert.equal(report.checks.some((check) => check.id === "session_store" && check.status === "blocked"), true);
});

test("blocks readiness when Telegram briefs or scheduler are not configured", () => {
  const report = buildCeoReadinessReport(readyInput({
    telegram: { tokenConfigured: false, chatConfigured: false, enabled: false, webhookRegistered: false },
    scheduler: { ceoBriefHour: 30 },
  }));

  assert.equal(report.ready, false);
  assert.equal(report.status, "blocked");
  assert.equal(report.checks.some((check) => check.id === "telegram_briefs" && check.status === "blocked"), true);
  assert.equal(report.checks.some((check) => check.id === "scheduler" && check.status === "blocked"), true);
});

test("blocks Telegram chat readiness when AI integration is missing", () => {
  const report = buildCeoReadinessReport(readyInput({
    assistant: { aiConfigured: false },
  }));

  assert.equal(report.ready, false);
  assert.equal(report.status, "blocked");
  assert.equal(report.checks.some((check) => check.id === "assistant_ai" && check.status === "blocked"), true);
  assert.equal(report.checks.some((check) => check.id === "telegram_chat" && check.status === "blocked"), true);
});
