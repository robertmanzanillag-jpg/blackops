import assert from "node:assert/strict";
import test from "node:test";
import { shouldUseCheapScoutForWebChat } from "../server/ai-router";

test("strict cost mode blocks OpenAI fallback when there is no explicit spend approval", () => {
  const previousStrict = process.env.BLACKOPS_STRICT_COST_MODE;
  const previousGemini = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  process.env.BLACKOPS_STRICT_COST_MODE = "true";
  delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;

  try {
    const route = shouldUseCheapScoutForWebChat({
      message: "quiero que hagas esta tarea pesada aqui",
      hasImages: false,
    });

    assert.equal(route.tier, "subscription_handoff");
    assert.equal(route.provider, "membership");
  } finally {
    if (previousStrict === undefined) delete process.env.BLACKOPS_STRICT_COST_MODE;
    else process.env.BLACKOPS_STRICT_COST_MODE = previousStrict;
    if (previousGemini === undefined) delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    else process.env.AI_INTEGRATIONS_GEMINI_API_KEY = previousGemini;
  }
});

test("explicit Robert approval allows OpenAI fallback despite strict cost mode", () => {
  const previousStrict = process.env.BLACKOPS_STRICT_COST_MODE;
  const previousGemini = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  process.env.BLACKOPS_STRICT_COST_MODE = "true";
  delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;

  try {
    const route = shouldUseCheapScoutForWebChat({
      message: "hazlo aqui, no pasa nada, aunque sea caro",
      hasImages: false,
    });

    assert.equal(route.tier, "strong_supervisor");
    assert.equal(route.provider, "openai");
    assert.match(route.reason, /approved API spend/i);
  } finally {
    if (previousStrict === undefined) delete process.env.BLACKOPS_STRICT_COST_MODE;
    else process.env.BLACKOPS_STRICT_COST_MODE = previousStrict;
    if (previousGemini === undefined) delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    else process.env.AI_INTEGRATIONS_GEMINI_API_KEY = previousGemini;
  }
});
