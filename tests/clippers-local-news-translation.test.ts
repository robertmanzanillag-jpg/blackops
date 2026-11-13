import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalNewsTranslator,
  OpenAiLocalNewsTranslationAdapter,
  detectLocalNewsLanguage,
  type LocalNewsTranslationAdapter,
  type LocalNewsTranslationDirection,
} from "../server/clippers-local-news-translation";

class FakeTranslationAdapter implements LocalNewsTranslationAdapter {
  calls = 0;
  private readonly handler: (input: string, direction: LocalNewsTranslationDirection) => string | Promise<string>;

  constructor(handler: (input: string, direction: LocalNewsTranslationDirection) => string | Promise<string>) {
    this.handler = handler;
  }

  async translate(input: string, direction: LocalNewsTranslationDirection): Promise<string> {
    this.calls += 1;
    return this.handler(input, direction);
  }
}

test("batches all fields from one story into one low-cost OpenAI request", async () => {
  const requests: any[] = [];
  const client = {
    chat: {
      completions: {
        create: async (request: unknown) => {
          requests.push(request);
          return {
            choices: [{ message: { content: JSON.stringify({
              translations: [
                "Choque cierra I-95",
                "La carretera está cerrada por una investigación policial.",
                "Consulta la fuente oficial antes de actuar.",
              ],
            }) } }],
          };
        },
      },
    },
  } as any;
  const adapter = new OpenAiLocalNewsTranslationAdapter({
    client,
    env: { CLIPPERS_LOCAL_NEWS_OPENAI_MODEL: "gpt-5.4-nano" },
  });
  const translator = new LocalNewsTranslator({ enabled: true, adapter });
  const inputs = [
    "Crash closes I-95",
    "The road is closed for a police investigation.",
    "Review the official source before taking action.",
  ];

  const first = await translator.translateMany(inputs, "en-es");
  const second = await translator.translateMany(inputs, "en-es");

  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, "gpt-5.4-nano");
  assert.equal(requests[0].reasoning_effort, "none");
  assert.deepEqual(JSON.parse(requests[0].messages[1].content), { inputs });
  assert.ok(first.every((result) => result.safe && result.status === "translated"));
  assert.ok(second.every((result) => result.safe && result.fromCache));
});

test("hosted batch translation fails closed when its JSON shape is incomplete", async () => {
  const client = {
    chat: { completions: { create: async () => ({
      choices: [{ message: { content: JSON.stringify({ translations: ["Choque cierra I-95"] }) } }],
    }) } },
  } as any;
  const translator = new LocalNewsTranslator({
    enabled: true,
    adapter: new OpenAiLocalNewsTranslationAdapter({ client, env: {} }),
  });

  const results = await translator.translateMany(["Crash closes I-95", "The road is closed."], "en-es");

  assert.ok(results.every((result) => !result.safe && result.status === "unavailable"));
  assert.ok(results.every((result) => result.issues.includes("local_translation_failed:openai_translation_shape_invalid")));
});

test("hosted provider failure opens a circuit for the cycle and recovers after cooldown", async () => {
  let calls = 0;
  let now = 1_000;
  let available = false;
  const client = {
    chat: { completions: { create: async () => {
      calls += 1;
      if (!available) throw new Error("provider_unavailable");
      return { choices: [{ message: { content: JSON.stringify({ translations: ["La carretera está cerrada."] }) } }] };
    } } },
  } as any;
  const adapter = new OpenAiLocalNewsTranslationAdapter({ client, env: {}, failureCooldownMs: 60_000 });
  const translator = new LocalNewsTranslator({ enabled: true, adapter, now: () => now });

  const first = await translator.translate("The road is closed.", "en-es");
  const held = await translator.translate("The road is closed for police.", "en-es");
  assert.equal(first.status, "unavailable");
  assert.ok(held.issues.includes("local_translation_failed:translation_provider_circuit_open"));
  assert.equal(calls, 1);

  now += 60_001;
  available = true;
  const recovered = await translator.translate("The road is closed.", "en-es");
  assert.equal(recovered.safe, true);
  assert.equal(calls, 2);
});

test("hosted translation request budget bounds one scheduler window", async () => {
  let calls = 0;
  const client = {
    chat: { completions: { create: async () => {
      calls += 1;
      return { choices: [{ message: { content: JSON.stringify({ translations: ["La carretera está cerrada."] }) } }] };
    } } },
  } as any;
  const adapter = new OpenAiLocalNewsTranslationAdapter({ client, env: {}, maxRequestsPerWindow: 2, requestWindowMs: 60_000 });
  const translator = new LocalNewsTranslator({ enabled: true, adapter, now: () => 1_000 });

  await translator.translate("The road is closed A.", "en-es");
  await translator.translate("The road is closed B.", "en-es");
  const held = await translator.translate("The road is closed C.", "en-es");

  assert.equal(calls, 2);
  assert.equal(held.status, "unavailable");
  assert.ok(held.issues.includes("local_translation_failed:translation_provider_budget_exhausted"));
});

test("detects common English and Spanish public-safety copy", () => {
  assert.equal(detectLocalNewsLanguage("The road is closed from 8 AM to 10 AM."), "en");
  assert.equal(detectLocalNewsLanguage("La carretera está cerrada de 8 AM a 10 AM."), "es");
  assert.equal(detectLocalNewsLanguage("Crash closes I-95"), "en");
  assert.equal(detectLocalNewsLanguage("Choque cierra I-95"), "es");
});

test("ambiguous target-language output fails closed", async () => {
  const adapter = new FakeTranslationAdapter(() => "Crash closes I-95!");
  const result = await new LocalNewsTranslator({ enabled: true, adapter }).translate("Crash closes I-95", "en-es");
  assert.equal(result.safe, false);
  assert.ok(result.issues.includes("unexpected_output_language:en"));
});

test("performs a substantive local translation and retains the exact original", async () => {
  const adapter = new FakeTranslationAdapter(() => "La carretera está cerrada por una investigación policial.");
  const translator = new LocalNewsTranslator({ enabled: true, adapter });
  const original = "The road is closed for a police investigation.";
  const result = await translator.translate(original, "en-es");

  assert.equal(result.status, "translated");
  assert.equal(result.safe, true);
  assert.equal(result.original, original);
  assert.equal(result.translated, "La carretera está cerrada por una investigación policial.");
  assert.equal(result.fromCache, false);
});

test("caches successful translations by exact input and direction", async () => {
  const adapter = new FakeTranslationAdapter(() => "La carretera está cerrada.");
  const translator = new LocalNewsTranslator({ enabled: true, adapter });

  const first = await translator.translate("The road is closed.", "en-es");
  const second = await translator.translate("The road is closed.", "en-es");

  assert.equal(first.fromCache, false);
  assert.equal(second.fromCache, true);
  assert.equal(second.translated, first.translated);
  assert.equal(adapter.calls, 1);
});

test("fails closed when numbers, URLs, or route identifiers change", async () => {
  const original = "The I-95 ramp closes at 8:30 near https://511.example/alert/42 for 2 hours.";
  const adapter = new FakeTranslationAdapter(() => "La rampa I-75 cierra a las 9:30 cerca de https://511.example/alert/41 por 3 horas.");
  const translator = new LocalNewsTranslator({ enabled: true, adapter });
  const result = await translator.translate(original, "en-es");

  assert.equal(result.status, "unsafe");
  assert.equal(result.safe, false);
  assert.equal(result.translated, null);
  assert.equal(result.original, original);
  assert.ok(result.issues.some((issue) => issue === "protected_token_missing:I-95"));
  assert.ok(result.issues.some((issue) => issue === "protected_token_missing:8:30"));
  assert.ok(result.issues.some((issue) => issue === "protected_token_missing:https://511.example/alert/42"));
});

test("fails closed when a translation adds numbers, URLs, or routes", async () => {
  const original = "The I-95 ramp closes at 8:30 near https://511.example/alert/42 for 2 hours.";
  const adapter = new FakeTranslationAdapter(() => "La rampa I-95 cierra a las 8:30 cerca de https://511.example/alert/42 durante 2 horas; I-75 a las 9:30 según https://evil.example/43.");
  const result = await new LocalNewsTranslator({ enabled: true, adapter }).translate(original, "en-es");

  assert.equal(result.status, "unsafe");
  assert.equal(result.safe, false);
  assert.ok(result.issues.includes("protected_token_unexpected:I-75"));
  assert.ok(result.issues.includes("protected_token_unexpected:9:30"));
  assert.ok(result.issues.includes("protected_token_unexpected:https://evil.example/43."));
});

test("accepts translations that preserve numbers, URLs, and routes exactly", async () => {
  const original = "The I-95 ramp closes at 8:30 near https://511.example/alert/42 for 2 hours.";
  const adapter = new FakeTranslationAdapter(
    () => "La rampa I-95 cierra a las 8:30 cerca de https://511.example/alert/42 durante 2 horas.",
  );
  const result = await new LocalNewsTranslator({ enabled: true, adapter }).translate(original, "en-es");

  assert.equal(result.status, "translated");
  assert.equal(result.safe, true);
});

test("fails closed on missing, unchanged, or rejected adapter output", async () => {
  for (const handler of [
    () => "",
    (input: string) => input,
    () => {
      throw new Error("model_not_installed");
    },
  ]) {
    const result = await new LocalNewsTranslator({
      enabled: true,
      adapter: new FakeTranslationAdapter(handler),
    }).translate("The road is closed.", "en-es");
    assert.equal(result.safe, false);
    assert.equal(result.translated, null);
    assert.ok(result.status === "unsafe" || result.status === "unavailable");
  }
});

test("is enabled by default in production without loading a model until called", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const adapter = new FakeTranslationAdapter(() => "La carretera está cerrada.");
    const result = await new LocalNewsTranslator({ adapter }).translate("The road is closed.", "en-es");
    assert.equal(result.safe, true);
    assert.equal(adapter.calls, 1);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
