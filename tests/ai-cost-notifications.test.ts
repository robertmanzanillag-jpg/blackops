import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateOpenAiAudioCostUsd,
  estimateTokenApiCostUsd,
  formatAiApiCostNotice,
  shouldNotifyAiApiCost,
} from "../server/ai-cost-notifications";

test("estimates Gemini Flash-Lite token cost with conservative defaults", () => {
  const cost = estimateTokenApiCostUsd({
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    inputTokens: 10_000,
    outputTokens: 1_000,
  });

  assert.equal(cost, 0.004);
});

test("estimates OpenAI transcription cost per minute", () => {
  const cost = estimateOpenAiAudioCostUsd({
    provider: "openai",
    model: "gpt-realtime-whisper",
    audioSeconds: 90,
  });

  assert.equal(cost, 0.0256);
});

test("formats a Spanish cost notice for chat and notifications", () => {
  const notice = formatAiApiCostNotice({
    provider: "openai",
    model: "gpt-5.4-mini",
    operation: "respuesta fuerte del chat",
    estimatedCostUsd: 0.0123,
  });

  assert.match(notice, /Aviso de costo API/);
  assert.match(notice, /OPENAI gpt-5\.4-mini/);
  assert.match(notice, /\$0\.0123 USD/);
});

test("does not notify below the configured cost floor", () => {
  const previous = process.env.BLACKOPS_AI_COST_NOTIFY_MIN_USD;
  process.env.BLACKOPS_AI_COST_NOTIFY_MIN_USD = "0.01";

  try {
    assert.equal(shouldNotifyAiApiCost(0.001), false);
    assert.equal(shouldNotifyAiApiCost(0.02), true);
  } finally {
    if (previous === undefined) {
      delete process.env.BLACKOPS_AI_COST_NOTIFY_MIN_USD;
    } else {
      process.env.BLACKOPS_AI_COST_NOTIFY_MIN_USD = previous;
    }
  }
});
