export type ReadinessStatus = "ready" | "warning" | "blocked";

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
}

export interface CeoReadinessInput {
  auth: {
    userId: string | null;
    devFallbackAllowed: boolean;
    usingDevFallback: boolean;
    defaultUserConfigured: boolean;
    sessionSecretConfigured?: boolean;
    sessionStoreKind?: "disabled" | "memory" | "postgres";
  };
  assistant: {
    aiConfigured: boolean;
  };
  telegram: {
    tokenConfigured: boolean;
    chatConfigured: boolean;
    enabled: boolean;
    webhookUrlConfigured: boolean;
    webhookRegistered: boolean;
    webhookMatchesExpected: boolean;
    webhookSecretConfigured: boolean;
    lastWebhookError?: string | null;
  };
  scheduler: {
    timezone: string;
    ceoBriefHour: number;
    ceoBriefMinute: number;
  };
}

export interface CeoReadinessReport {
  ready: boolean;
  status: ReadinessStatus;
  checks: ReadinessCheck[];
}

function worstStatus(checks: ReadinessCheck[]): ReadinessStatus {
  if (checks.some((check) => check.status === "blocked")) return "blocked";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "ready";
}

export function buildCeoReadinessReport(input: CeoReadinessInput): CeoReadinessReport {
  const schedulerValid = Number.isFinite(input.scheduler.ceoBriefHour)
    && input.scheduler.ceoBriefHour >= 0
    && input.scheduler.ceoBriefHour <= 23
    && Number.isFinite(input.scheduler.ceoBriefMinute)
    && input.scheduler.ceoBriefMinute >= 0
    && input.scheduler.ceoBriefMinute <= 59
    && input.scheduler.timezone.trim().length > 0;

  const checks: ReadinessCheck[] = [
    {
      id: "auth",
      label: "Auth and user context",
      status: input.auth.userId
        ? input.auth.usingDevFallback ? "warning" : "ready"
        : "blocked",
      detail: input.auth.userId
        ? input.auth.usingDevFallback
          ? "Using development fallback user. Configure a real auth provider or DEFAULT_USER_ID before production."
          : `Resolved user context: ${input.auth.userId}.`
        : "No user context resolved.",
    },
    {
      id: "assistant_ai",
      label: "Assistant AI",
      status: input.assistant.aiConfigured ? "ready" : "blocked",
      detail: input.assistant.aiConfigured
        ? "AI integration key is configured for chat responses."
        : "AI_INTEGRATIONS_GEMINI_API_KEY is required for Telegram chat and assistant responses.",
    },
    {
      id: "session_secret",
      label: "Session auth",
      status: input.auth.sessionSecretConfigured ? "ready" : "warning",
      detail: input.auth.sessionSecretConfigured
        ? "SESSION_SECRET is configured for session-based login."
        : "SESSION_SECRET is missing. Local session login is disabled in production unless this is configured.",
    },
    {
      id: "session_store",
      label: "Session store",
      status: input.auth.sessionStoreKind === "postgres"
        ? "ready"
        : input.auth.sessionStoreKind === "memory" ? "warning" : "blocked",
      detail: input.auth.sessionStoreKind === "postgres"
        ? "Sessions are persisted in Postgres."
        : input.auth.sessionStoreKind === "memory"
        ? "Sessions use in-memory storage. This is fine for local dev, but production should configure DATABASE_URL for persistent sessions."
        : "Session middleware is disabled.",
    },
    {
      id: "telegram_briefs",
      label: "Telegram morning briefs",
      status: input.telegram.tokenConfigured && input.telegram.chatConfigured && input.telegram.enabled
        ? "ready"
        : "blocked",
      detail: input.telegram.tokenConfigured && input.telegram.chatConfigured && input.telegram.enabled
        ? "Bot token, chat, and notifications are configured."
        : "Missing bot token, chat configuration, or enabled notifications.",
    },
    {
      id: "telegram_chat",
      label: "Telegram chat",
      status: input.assistant.aiConfigured && input.telegram.tokenConfigured && input.telegram.chatConfigured && input.telegram.enabled && input.telegram.webhookRegistered
        ? input.telegram.webhookMatchesExpected ? "ready" : "warning"
        : "blocked",
      detail: input.telegram.webhookRegistered
        ? !input.assistant.aiConfigured
          ? "Webhook is registered, but AI integration is missing."
          : input.telegram.webhookMatchesExpected
          ? "Webhook is registered and matches the expected URL."
          : "Webhook is registered but does not match the expected URL."
        : "Webhook is not registered.",
    },
    {
      id: "telegram_webhook_secret",
      label: "Telegram webhook secret",
      status: input.telegram.webhookSecretConfigured ? "ready" : "warning",
      detail: input.telegram.webhookSecretConfigured
        ? "Webhook secret token is configured."
        : "Webhook works without a secret, but production should configure TELEGRAM_WEBHOOK_SECRET.",
    },
    {
      id: "scheduler",
      label: "Morning scheduler",
      status: schedulerValid ? "ready" : "blocked",
      detail: schedulerValid
        ? `CEO brief scheduled at ${String(input.scheduler.ceoBriefHour).padStart(2, "0")}:${String(input.scheduler.ceoBriefMinute).padStart(2, "0")} (${input.scheduler.timezone}).`
        : "Scheduler timezone or CEO brief time is invalid.",
    },
  ];

  if (input.telegram.lastWebhookError) {
    checks.push({
      id: "telegram_webhook_error",
      label: "Telegram webhook last error",
      status: "warning",
      detail: input.telegram.lastWebhookError,
    });
  }

  const status = worstStatus(checks);
  return {
    ready: status === "ready",
    status,
    checks,
  };
}
