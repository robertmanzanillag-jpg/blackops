import type { TelegramConfig } from "@shared/schema";
import { buildCeoReadinessReport } from "./ceo-readiness";
import { hasRealValue, hasStrongSecret } from "./ceo-doctor-cli";

export type TelegramWebhookStatus = {
  url?: string | null;
  pending_update_count?: number;
  last_error_message?: string | null;
};

export type TelegramSchedulerConfig = {
  timezone: string;
  ceoBriefHour: number;
  ceoBriefMinute: number;
};

export type TelegramHealthPayload = {
  tokenConfigured: boolean;
  aiConfigured: boolean;
  webhookSecretConfigured: boolean;
  webhookUrlConfigured: boolean;
  chatConfigured: boolean;
  enabled: boolean;
  chatId: string | null;
  webhookUrl: string | null;
  expectedWebhookUrl: string | null;
  webhookMatchesExpected: boolean;
  pendingUpdates: number;
  lastWebhookError: string | null;
  readyForBriefs: boolean;
  readyForChat: boolean;
  scheduler: TelegramSchedulerConfig;
};

export type TelegramRuntimeReadinessInput = {
  userId: string | null;
  devFallbackAllowed: boolean;
  usingDevFallback: boolean;
  defaultUserId?: string;
  sessionSecret?: string;
  sessionStoreKind?: "disabled" | "memory" | "postgres";
  aiKey?: string;
  botToken?: string;
  webhookSecret?: string;
  config?: Pick<TelegramConfig, "chatId" | "enabled"> | null;
  webhook?: TelegramWebhookStatus | null;
  expectedWebhookUrl: string | null;
  scheduler: TelegramSchedulerConfig;
};

export function buildTelegramHealthPayload(input: {
  aiKey?: string;
  botToken?: string;
  webhookSecret?: string;
  config?: Pick<TelegramConfig, "chatId" | "enabled"> | null;
  webhook?: TelegramWebhookStatus | null;
  expectedWebhookUrl: string | null;
  scheduler: TelegramSchedulerConfig;
}): TelegramHealthPayload {
  const tokenConfigured = hasRealValue(input.botToken);
  const aiConfigured = hasRealValue(input.aiKey);
  const chatConfigured = Boolean(input.config?.chatId);
  const enabled = Boolean(input.config?.enabled);
  const webhookRegistered = Boolean(input.webhook?.url);

  return {
    tokenConfigured,
    aiConfigured,
    webhookSecretConfigured: hasStrongSecret(input.webhookSecret, 16),
    webhookUrlConfigured: Boolean(input.expectedWebhookUrl),
    chatConfigured,
    enabled,
    chatId: input.config?.chatId || null,
    webhookUrl: input.webhook?.url || null,
    expectedWebhookUrl: input.expectedWebhookUrl,
    webhookMatchesExpected: Boolean(input.expectedWebhookUrl && input.webhook?.url === input.expectedWebhookUrl),
    pendingUpdates: input.webhook?.pending_update_count || 0,
    lastWebhookError: input.webhook?.last_error_message || null,
    readyForBriefs: tokenConfigured && chatConfigured && enabled,
    readyForChat: aiConfigured && tokenConfigured && chatConfigured && enabled && webhookRegistered,
    scheduler: input.scheduler,
  };
}

export function buildTelegramCeoReadinessPayload(input: TelegramRuntimeReadinessInput) {
  return buildCeoReadinessReport({
    auth: {
      userId: input.userId,
      devFallbackAllowed: input.devFallbackAllowed,
      usingDevFallback: input.usingDevFallback,
      defaultUserConfigured: hasRealValue(input.defaultUserId),
      sessionSecretConfigured: hasStrongSecret(input.sessionSecret),
      sessionStoreKind: input.sessionStoreKind,
    },
    assistant: {
      aiConfigured: hasRealValue(input.aiKey),
    },
    telegram: {
      tokenConfigured: hasRealValue(input.botToken),
      chatConfigured: Boolean(input.config?.chatId),
      enabled: Boolean(input.config?.enabled),
      webhookUrlConfigured: Boolean(input.expectedWebhookUrl),
      webhookRegistered: Boolean(input.webhook?.url),
      webhookMatchesExpected: Boolean(input.expectedWebhookUrl && input.webhook?.url === input.expectedWebhookUrl),
      webhookSecretConfigured: hasStrongSecret(input.webhookSecret, 16),
      lastWebhookError: input.webhook?.last_error_message || null,
    },
    scheduler: input.scheduler,
  });
}
