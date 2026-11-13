type AiProvider = "openai" | "gemini";

interface TokenCostInput {
  provider: AiProvider;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

interface AudioCostInput {
  provider: "openai";
  model: string;
  audioSeconds?: number | null;
}

interface AiCostEventInput {
  userId: string;
  provider: AiProvider;
  model: string;
  operation: string;
  estimatedCostUsd: number;
  metadata?: Record<string, unknown>;
}

function readUsdEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function roundUsd(value: number): number {
  return Math.ceil(Math.max(0, value) * 10000) / 10000;
}

function openAiTokenRates(model: string): { input: number; output: number } {
  const normalized = model.toLowerCase();
  if (normalized.includes("gpt-5.5")) {
    return {
      input: readUsdEnv("BLACKOPS_OPENAI_GPT55_INPUT_USD_PER_1M", 5),
      output: readUsdEnv("BLACKOPS_OPENAI_GPT55_OUTPUT_USD_PER_1M", 30),
    };
  }
  if (normalized.includes("gpt-5.4-mini") || normalized.includes("mini")) {
    return {
      input: readUsdEnv("BLACKOPS_OPENAI_MINI_INPUT_USD_PER_1M", 0.75),
      output: readUsdEnv("BLACKOPS_OPENAI_MINI_OUTPUT_USD_PER_1M", 4.5),
    };
  }
  return {
    input: readUsdEnv("BLACKOPS_OPENAI_INPUT_USD_PER_1M", 2.5),
    output: readUsdEnv("BLACKOPS_OPENAI_OUTPUT_USD_PER_1M", 15),
  };
}

function geminiTokenRates(model: string): { input: number; output: number } {
  const normalized = model.toLowerCase();
  if (normalized.includes("flash-lite")) {
    return {
      input: readUsdEnv("BLACKOPS_GEMINI_FLASH_LITE_INPUT_USD_PER_1M", 0.25),
      output: readUsdEnv("BLACKOPS_GEMINI_FLASH_LITE_OUTPUT_USD_PER_1M", 1.5),
    };
  }
  return {
    input: readUsdEnv("BLACKOPS_GEMINI_INPUT_USD_PER_1M", 0.5),
    output: readUsdEnv("BLACKOPS_GEMINI_OUTPUT_USD_PER_1M", 3),
  };
}

export function estimateTokenApiCostUsd(input: TokenCostInput): number {
  const rates = input.provider === "openai"
    ? openAiTokenRates(input.model)
    : geminiTokenRates(input.model);
  const inputTokens = Math.max(0, input.inputTokens || 0);
  const outputTokens = Math.max(0, input.outputTokens || 0);
  return roundUsd(((inputTokens / 1_000_000) * rates.input) + ((outputTokens / 1_000_000) * rates.output));
}

export function estimateOpenAiAudioCostUsd(input: AudioCostInput): number {
  const seconds = Math.max(1, input.audioSeconds || 60);
  const usdPerMinute = readUsdEnv("BLACKOPS_OPENAI_TRANSCRIPTION_USD_PER_MINUTE", 0.017);
  return roundUsd((seconds / 60) * usdPerMinute);
}

export function shouldNotifyAiApiCost(estimatedCostUsd: number): boolean {
  const minimum = readUsdEnv("BLACKOPS_AI_COST_NOTIFY_MIN_USD", 0.0001);
  return estimatedCostUsd >= minimum;
}

export function formatAiApiCostNotice(event: Pick<AiCostEventInput, "provider" | "model" | "operation" | "estimatedCostUsd">): string {
  return [
    "Aviso de costo API:",
    `${event.provider.toUpperCase()} ${event.model}`,
    event.operation,
    `~$${event.estimatedCostUsd.toFixed(4)} USD`,
  ].join(" ");
}

export async function recordAiApiCostEvent(event: AiCostEventInput): Promise<string | null> {
  if (!shouldNotifyAiApiCost(event.estimatedCostUsd)) return null;

  const notice = formatAiApiCostNotice(event);
  const metadata = {
    provider: event.provider,
    model: event.model,
    operation: event.operation,
    estimatedCostUsd: event.estimatedCostUsd,
    ...event.metadata,
  };

  const { writeAuditLog } = await import("./trust-policy");
  await writeAuditLog({
    userId: event.userId,
    actorType: "assistant",
    actorId: "blackops-ai-cost-monitor",
    origin: "web",
    actionType: "ai_api.cost_estimated",
    resourceType: "ai_api_usage",
    resourceId: `${event.provider}:${event.model}`,
    metadata,
    status: "succeeded",
    executionMode: "automatic",
  });

  try {
    const { sendPushNotification } = await import("./push-notifications");
    await sendPushNotification(event.userId, {
      title: "Costo API registrado",
      body: notice,
      tag: "ai-api-cost",
    });
  } catch (error) {
    console.warn("AI cost push notification failed:", error);
  }

  try {
    const { storage } = await import("./storage");
    const { sendTelegramPlainMessage } = await import("./telegram");
    const telegramConfig = await storage.getTelegramConfig(event.userId);
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (telegramConfig?.enabled && telegramConfig.chatId && botToken) {
      await sendTelegramPlainMessage(botToken, telegramConfig.chatId, notice);
    }
  } catch (error) {
    console.warn("AI cost Telegram notification failed:", error);
  }

  return notice;
}
