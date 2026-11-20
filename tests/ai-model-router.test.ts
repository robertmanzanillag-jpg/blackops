import {fixtureFactoryInvocation} from './fixtures/factory-api-budget';
const factoryPricing=(_provider:unknown,model:string)=>({model,inputNanoUsdPerToken:400,outputNanoUsdPerToken:1600,validUntil:'2027-01-01T00:00:00.000Z',evidenceSha256:'a'.repeat(64)});
const createRoutedOpenAI:typeof actualCreateRoutedOpenAI=options=>actualCreateRoutedOpenAI({...options,factoryInvocation:fixtureFactoryInvocation(),factoryPricing});
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AiBudgetUnavailableError,
  InMemoryAiProviderLedger,
  aiRouterConfig,
  chatCompletionToResponse,
  createRoutedOpenAI as actualCreateRoutedOpenAI,
  estimateReservationUsd,
  openAiClientOptions,
  planProviders,
  responsesToDeepSeekChatBody,
  routerCostUsd,
  toDeepSeekChatBody,
  type ChatLikeClient,
  type ProviderConfig,
} from "../server/ai-model-router";

const KEYS = { AI_ROUTER_ENABLED: "true", OPENAI_API_KEY: "sk-own", DEEPSEEK_API_KEY: "ds-key", DEEPSEEK_MODEL: "deepseek-flash", AI_INTEGRATIONS_OPENAI_API_KEY: "replit-key", AI_INTEGRATIONS_OPENAI_BASE_URL: "https://replit.example/v1" };

type Call = { provider: string; body: any };
function fakeClients(behaviour: Partial<Record<string, "ok" | "error" | "reject400">> = {}) {
  const calls: Call[] = [];
  const make = (provider: ProviderConfig): ChatLikeClient => {
    const respond = (body: any) => {
      calls.push({ provider: provider.id, body });
      const mode = behaviour[provider.id] ?? "ok";
      if (mode === "error") return Promise.reject(Object.assign(new Error(`${provider.id} down`), { status: 503 }));
      if (mode === "reject400") return Promise.reject(Object.assign(new Error("bad request"), { status: 400 }));
      return Promise.resolve({
        id: "c1", model: body.model,
        choices: [{ message: { content: `{"from":"${provider.id}"}` }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1000, completion_tokens: Math.min(100,body.max_completion_tokens??body.max_tokens??100),prompt_tokens_details:{cached_tokens:0},prompt_cache_hit_tokens:0 },
      });
    };
    return {
      chat: { completions: { create: (body: any) => respond(body) } },
      responses: { create: async (body: any) => {
        calls.push({ provider: provider.id, body });
        if ((behaviour[provider.id] ?? "ok") === "error") throw Object.assign(new Error("down"), { status: 500 });
        return { id:"r1",status:"completed",model: body.model, output_text: "hola", output: [{ type: "message" }], usage: { input_tokens: 2000, output_tokens: 200,input_tokens_details:{cached_tokens:0} } };
      } },
      audio: { transcriptions: { create: async (body: any) => { calls.push({ provider: provider.id, body }); return { text: "audio" }; } } },
    };
  };
  return { calls, make };
}

const chatBody = { model: "gpt-4o", messages: [{ role: "user", content: "hola" }], max_completion_tokens: 200 };

test("tier plans: repetitive -> deepseek first, standard/critical -> openai first, integration last", () => {
  const c = aiRouterConfig(KEYS);
  assert.deepEqual(planProviders("repetitive", c), ["deepseek", "openai", "integration"]);
  assert.deepEqual(planProviders("standard", c), ["openai", "deepseek", "integration"]);
  assert.deepEqual(planProviders("critical", c), ["openai", "deepseek", "integration"]);
  assert.deepEqual(planProviders("repetitive", c, { openAiOnly: true }), ["openai", "integration"]);
  assert.deepEqual(planProviders("standard", aiRouterConfig({ ...KEYS, AI_INTEGRATIONS_FALLBACK_ENABLED: "false" })), ["openai", "deepseek"]);
});

test("DeepSeek is unconfigured unless both DEEPSEEK_API_KEY and DEEPSEEK_MODEL are set", () => {
  assert.equal(aiRouterConfig({ DEEPSEEK_API_KEY: "ds" }).deepseek, null);
  assert.equal(aiRouterConfig({ DEEPSEEK_API_KEY: "ds" }).enabled, false);
  assert.equal(aiRouterConfig({ DEEPSEEK_MODEL: "deepseek-flash" }).deepseek, null);
  assert.equal(aiRouterConfig({ AI_ROUTER_ENABLED: "true", DEEPSEEK_API_KEY: "ds", DEEPSEEK_MODEL: "m" }).deepseek?.strongModel, "m");
});

test("defaults: OpenAI cap $200, DeepSeek cap $50, own key preferred over Replit integration", () => {
  const c = aiRouterConfig(KEYS);
  assert.equal(c.openai?.monthlyCapUsd, 200);
  assert.equal(c.deepseek?.monthlyCapUsd, 50);
  assert.equal(c.deepseek?.model, "deepseek-flash");
  assert.equal(c.deepseek?.baseURL, "https://api.deepseek.com");
  assert.deepEqual(openAiClientOptions(KEYS), { apiKey: "sk-own", baseURL: undefined, source: "own" });
  assert.equal(openAiClientOptions({ AI_INTEGRATIONS_OPENAI_API_KEY: "r", AI_INTEGRATIONS_OPENAI_BASE_URL: "u" }).source, "integration");
});

test("repetitive goes to DeepSeek with its model, thinking off and the request reserved + settled", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const { calls, make } = fakeClients();
  const client = createRoutedOpenAI({ tier: "repetitive", label: "t", env: KEYS, ledger, makeClient: make });
  const result = await client.chat.completions.create(chatBody);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, "deepseek");
  assert.equal(calls[0].body.model, "deepseek-flash");
  assert.deepEqual(calls[0].body.thinking, { type: "disabled" });
  assert.equal(calls[0].body.max_tokens, 200);
  assert.equal(calls[0].body.max_completion_tokens, undefined);
  assert.equal(result.model, "deepseek-flash");
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.rows[0].status, "settled");
  assert.equal(ledger.rows[0].costUsd, routerCostUsd("deepseek-flash", 1000, 100));
});

test("standard goes to OpenAI own key with the caller's model", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const { calls, make } = fakeClients();
  await createRoutedOpenAI({ tier: "standard", label: "t", env: KEYS, ledger, makeClient: make }).chat.completions.create(chatBody);
  assert.equal(calls[0].provider, "openai");
  assert.equal(calls[0].body.model, "gpt-4o");
  assert.equal(ledger.rows[0].provider, "openai");
  assert.equal(ledger.rows[0].costUsd, routerCostUsd("gpt-4o", 1000, 100));
});

test("OpenAI cap exhausted -> DeepSeek; critical uses DEEPSEEK_STRONG_MODEL", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const env = { ...KEYS, AI_OPENAI_MONTHLY_BUDGET_USD: "1", DEEPSEEK_STRONG_MODEL: "deepseek-v4-pro" };
  await ledger.reserve({ provider: "openai", tier: "standard", label: "seed", model: "gpt-4o", amountUsd: 0.9999, monthlyCapUsd: 1 });
  const { calls, make } = fakeClients();
  await createRoutedOpenAI({ tier: "critical", label: "t", env, ledger, makeClient: make }).chat.completions.create(chatBody);
  assert.deepEqual(calls.map((c) => c.provider), ["deepseek"]);
  assert.equal(calls[0].body.model, "deepseek-v4-pro");
});

test("both caps exhausted -> AiBudgetUnavailableError and never spills to Replit integration", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const env = { ...KEYS, AI_OPENAI_MONTHLY_BUDGET_USD: "0", AI_DEEPSEEK_MONTHLY_BUDGET_USD: "0" };
  const { calls, make } = fakeClients();
  await assert.rejects(createRoutedOpenAI({ tier: "standard", label: "t", env, ledger, makeClient: make }).chat.completions.create(chatBody), AiBudgetUnavailableError);
  assert.equal(calls.length, 0);
  assert.equal(ledger.rows.length, 0);
});

test("unconfirmed provider error retains its hold and never falls through to another paid provider",async()=>{
 const ledger=new InMemoryAiProviderLedger(),{calls,make}=fakeClients({openai:"error"});
 await assert.rejects(createRoutedOpenAI({tier:"standard",label:"t",env:KEYS,ledger,makeClient:make}).chat.completions.create(chatBody),/FACTORY_API_EXECUTION_UNCONFIRMED/);
 assert.deepEqual(calls.map(c=>c.provider),["openai"]);assert.equal(ledger.rows[0].status,"failed");assert.equal(ledger.rows[0].costUsd,ledger.rows[0].reservedUsd);
});

test("HTTP400 alone is not a billing receipt and cannot release or retry an uncertain call",async()=>{
 const ledger=new InMemoryAiProviderLedger(),{calls,make}=fakeClients({deepseek:"reject400"});
 await assert.rejects(createRoutedOpenAI({tier:"repetitive",label:"t",env:KEYS,ledger,makeClient:make}).chat.completions.create(chatBody),/FACTORY_API_EXECUTION_UNCONFIRMED/);
 assert.deepEqual(calls.map(c=>c.provider),["deepseek"]);assert.equal(ledger.rows[0].costUsd,ledger.rows[0].reservedUsd);
});

test("integration cannot become an uncapped retry after uncertain own-provider execution",async()=>{
 const ledger=new InMemoryAiProviderLedger(),{calls,make}=fakeClients({openai:"error",deepseek:"error"});
 await assert.rejects(createRoutedOpenAI({tier:"standard",label:"t",env:KEYS,ledger,makeClient:make}).chat.completions.create(chatBody),/FACTORY_API_EXECUTION_UNCONFIRMED/);
 assert.deepEqual(calls.map(c=>c.provider),["openai"]);
});

test("ledger failure: an own-key provider is never called without a reservation", async () => {
  const { calls, make } = fakeClients();
  const broken = { reserve: async () => { throw new Error("db down"); }, settle: async () => undefined, monthToDate: async () => 0 };
  await createRoutedOpenAI({ tier: "standard", label: "t", env: { AI_ROUTER_ENABLED: "true", OPENAI_API_KEY: "sk-own" }, ledger: broken, makeClient: make })
    .chat.completions.create(chatBody).then(() => assert.fail("should not succeed"), () => undefined);
  assert.equal(calls.length, 0);
});

test("no own key configured: legacy client is monetary guarded without secondary provider ledger", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const legacyCalls: any[] = [];
  const legacy: ChatLikeClient = { chat: { completions: { create: async (body: any, opts: any) => { legacyCalls.push({ body, opts }); return {ok:true,id:"legacy",model:body.model,choices:[{finish_reason:"stop"}],usage:{prompt_tokens:10,completion_tokens:5,prompt_tokens_details:{cached_tokens:0}}}; } } } };
  const client = createRoutedOpenAI({ tier: "repetitive", label: "t", env: { AI_INTEGRATIONS_OPENAI_API_KEY: "replit-key" }, ledger, legacy: () => legacy,
    makeClient: () => { throw new Error("must not build provider clients"); } });
  assert.equal(client.routed, false);
  const opts = { timeout: 1 };
  assert.equal((await client.chat.completions.create(chatBody, opts)).ok,true);
  assert.deepEqual(legacyCalls[0].body, chatBody);assert.notEqual(legacyCalls[0].body,chatBody);
  assert.equal(legacyCalls[0].opts.maxRetries,0);assert.ok(legacyCalls[0].opts.signal instanceof AbortSignal);
  assert.equal(ledger.rows.length, 0);
});

test("hosted web search without a verified maximum is held before provider dispatch",async()=>{
 const ledger=new InMemoryAiProviderLedger(),{calls,make}=fakeClients();
 await assert.rejects(createRoutedOpenAI({tier:"repetitive",label:"t",env:KEYS,ledger,makeClient:make}).responses!.create({model:"gpt-4o-mini",input:"find events",tools:[{type:"web_search"}],max_output_tokens:500}),/FACTORY_API_OPERATION_UNPRICED/);
 assert.equal(calls.length,0);assert.equal(ledger.rows.length,0);
});

test("responses API without hosted tools is translated for DeepSeek and returned in Responses shape", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const { calls, make } = fakeClients();
  const body = {
    model: "gpt-5.6-luna", instructions: "Eres el agente", input: "{\"q\":1}", max_output_tokens: 300, store: false,
    reasoning: { effort: "low" }, text: { verbosity: "low", format: { type: "json_schema", name: "x", strict: true, schema: { type: "object" } } },
  };
  const res = await createRoutedOpenAI({ tier: "repetitive", label: "t", env: KEYS, ledger, makeClient: make }).responses!.create(body);
  assert.equal(calls[0].provider, "deepseek");
  assert.equal(calls[0].body.response_format.type, "json_object");
  assert.match(calls[0].body.messages[0].content, /json/);
  assert.equal(calls[0].body.messages[1].content, "Eres el agente");
  assert.equal(calls[0].body.max_tokens, 300);
  assert.equal(calls[0].body.store, undefined);
  assert.equal(res.output_text, "{\"from\":\"deepseek\"}");
  assert.equal(res.usage.input_tokens, 1000);
  assert.equal(res.status, "completed");
});

test("audio without verified usage pricing is held before provider dispatch",async()=>{
 const ledger=new InMemoryAiProviderLedger(),{calls,make}=fakeClients();
 await assert.rejects(createRoutedOpenAI({tier:"standard",label:"t",env:KEYS,ledger,makeClient:make}).audio!.transcriptions.create({model:"whisper-1",file:"x"}),/FACTORY_API_OPERATION_UNPRICED/);
 assert.equal(calls.length,0);assert.equal(ledger.rows.length,0);
});

test("ledger accounting: month-to-date sums settled + reserved rows per provider and enforces the cap", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const r1 = await ledger.reserve({ provider: "openai", tier: "standard", label: "a", model: "gpt-4o", amountUsd: 1, monthlyCapUsd: 2 });
  await ledger.settle(r1!, { ok: true, costUsd: 0.25 });
  const r2 = await ledger.reserve({ provider: "openai", tier: "standard", label: "b", model: "gpt-4o", amountUsd: 1.5, monthlyCapUsd: 2 });
  assert.ok(r2);
  assert.equal(await ledger.monthToDate("openai"), 1.75);
  assert.equal(await ledger.reserve({ provider: "openai", tier: "standard", label: "c", model: "gpt-4o", amountUsd: 0.3, monthlyCapUsd: 2 }), null);
  assert.equal(await ledger.monthToDate("deepseek"), 0);
  await ledger.settle(r1!, { ok: true, costUsd: 99 }); // settling twice is a no-op
  assert.equal(await ledger.monthToDate("openai"), 1.75);
});

test("adapters and estimates", () => {
  const ds = toDeepSeekChatBody({ model: "gpt-4o", messages: [], store: true, safety_identifier: "x", response_format: { type: "json_object" } }, "deepseek-flash", false);
  assert.equal(ds.store, undefined);
  assert.equal(ds.safety_identifier, undefined);
  assert.equal(ds.messages[0].role, "system");
  const r = responsesToDeepSeekChatBody({ input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }] }, "deepseek-flash", true);
  assert.equal(r.thinking, undefined);
  assert.equal(r.messages[0].content, "hi");
  const resp = chatCompletionToResponse({ choices: [{ message: { content: "x" }, finish_reason: "length" }], usage: { prompt_tokens: 1, completion_tokens: 2 } }, "deepseek-flash");
  assert.equal(resp.status, "incomplete");
  assert.ok(estimateReservationUsd("gpt-4o", chatBody) > routerCostUsd("gpt-4o", 0, 200));
  assert.equal(routerCostUsd("gpt-5.6-luna", 1e6, 0), 1.25); // gpt-5 prefix, same as aiUsage
  assert.equal(routerCostUsd("unknown-model", 1e6, 0), 5);
});

test("ledger unavailable: fail closed, never falls through to uncapped Replit integration", async () => {
  const { calls, make } = fakeClients();
  const broken = { reserve: async () => { throw new Error("db down"); }, settle: async () => undefined, monthToDate: async () => 0 };
  await assert.rejects(
    createRoutedOpenAI({ tier: "standard", label: "t", env: KEYS, ledger: broken, makeClient: make }).chat.completions.create(chatBody),
    AiBudgetUnavailableError,
  );
  assert.equal(calls.length, 0);
});

test("concurrent reservations are serialized and never exceed the cap", async () => {
  const ledger = new InMemoryAiProviderLedger(5);
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    ledger.reserve({ provider: "openai", tier: "standard", label: `c${i}`, model: "gpt-4o", amountUsd: 0.3, monthlyCapUsd: 1 })));
  assert.equal(results.filter(Boolean).length, 3);
  assert.ok((await ledger.monthToDate("openai")) <= 1);
});

test("concurrent routed calls stop at the OpenAI cap and spill to DeepSeek, not past the cap", async () => {
  const ledger = new InMemoryAiProviderLedger(2);
  const { calls, make } = fakeClients();
  const env = { ...KEYS, AI_OPENAI_MONTHLY_BUDGET_USD: "0.0005" };
  const client = createRoutedOpenAI({ tier: "standard", label: "t", env, ledger, makeClient: make });
  // Prompt large enough that the reservation upper-bounds the fake usage (1000 in / 100 out).
  const big = { model: "gpt-4o-mini", messages: [{ role: "user", content: "x".repeat(4000) }], max_completion_tokens: 200 };
  await Promise.all(Array.from({ length: 6 }, () => client.chat.completions.create(big)));
  assert.ok((await ledger.monthToDate("openai")) <= 0.0005);
  assert.ok(calls.some((c) => c.provider === "deepseek"));
  assert.ok(!calls.some((c) => c.provider === "integration"));
});

test("tier can depend on the request (owner chat standard, scheduled brief repetitive)", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const { calls, make } = fakeClients();
  const client = createRoutedOpenAI({ tier: (b) => (b.instructions === "CHAT" ? "standard" : "repetitive"), label: "t", env: KEYS, ledger, makeClient: make });
  await client.responses!.create({ model: "gpt-5.6-sol", instructions: "CHAT", input: "x".repeat(2000),max_output_tokens:300 });
  await client.responses!.create({ model: "gpt-5.6-sol", instructions: "BRIEF", input: "x".repeat(2000),max_output_tokens:300 });
  assert.deepEqual(calls.map((c) => c.provider), ["openai", "deepseek"]);
});

test("BlackOps: router is OFF unless AI_ROUTER_ENABLED=true, even with OPENAI_API_KEY and DeepSeek set", async () => {
  const { deepSeekRouted } = await import("../server/ai-model-router");
  const env = { OPENAI_API_KEY: "sk-own", DEEPSEEK_API_KEY: "ds", DEEPSEEK_MODEL: "deepseek-flash" };
  assert.equal(aiRouterConfig(env).enabled, false);
  assert.equal(deepSeekRouted(env), false);
  assert.equal(aiRouterConfig({ ...env, AI_ROUTER_ENABLED: "false" }).enabled, false);
  assert.equal(deepSeekRouted({ ...env, AI_ROUTER_ENABLED: "true" }), true);
  const legacyCalls: any[] = [];
  const client = createRoutedOpenAI({ tier: "standard", label: "t", env, ledger: new InMemoryAiProviderLedger(),
    legacy: () => ({ chat: { completions: { create: async (b: any) => { legacyCalls.push(b); return {ok:1,id:"legacy",model:b.model,choices:[{finish_reason:"stop"}],usage:{prompt_tokens:10,completion_tokens:5,prompt_tokens_details:{cached_tokens:0}}}; } } } }),
    makeClient: () => { throw new Error("must not build provider clients"); } });
  await client.chat.completions.create(chatBody);
  assert.equal(legacyCalls.length, 1);
});

test("streaming without complete verified final usage is held and cannot trigger fallback",async()=>{
 const ledger=new InMemoryAiProviderLedger(),{calls,make}=fakeClients({openai:"error"});
 await assert.rejects(createRoutedOpenAI({tier:"standard",label:"t",env:KEYS,ledger,makeClient:make}).chat.completions.create({...chatBody,stream:true,stream_options:{include_usage:true}}),/FACTORY_API_OPERATION_UNPRICED/);
 assert.equal(calls.length,0);assert.equal(ledger.rows.length,0);
});

test("routedText: repetitive prompt goes to DeepSeek and reports provider, model and cost", async () => {
  const { routedText } = await import("../server/ai-model-router");
  const ledger = new InMemoryAiProviderLedger();
  const { calls, make } = fakeClients();
  const out = await routedText({ tier: "repetitive", label: "telegram-chat", prompt: "hola", maxTokens: 50, env: KEYS, ledger, makeClient: make,factoryInvocation:fixtureFactoryInvocation(),factoryPricing });
  assert.equal(out.provider, "deepseek");
  assert.equal(out.model, "deepseek-flash");
  assert.equal(calls[0].body.max_tokens, 50);
  assert.equal(out.costUsd, routerCostUsd("deepseek-flash", 1000, 50));
});

test("web chat cheap scout: DeepSeek only with AI_ROUTER_ENABLED=true + DeepSeek key/model, Gemini otherwise", async () => {
  const { shouldUseCheapScoutForWebChat } = await import("../server/ai-router");
  const saved = { ...process.env };
  try {
    process.env.AI_INTEGRATIONS_GEMINI_API_KEY = "g";
    process.env.DEEPSEEK_API_KEY = "ds";
    process.env.DEEPSEEK_MODEL = "deepseek-flash";
    delete process.env.AI_ROUTER_ENABLED;
    assert.equal(shouldUseCheapScoutForWebChat({ message: "dame ideas de captions" }).provider, "gemini");
    process.env.AI_ROUTER_ENABLED = "true";
    assert.equal(shouldUseCheapScoutForWebChat({ message: "dame ideas de captions" }).provider, "deepseek");
    delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    const route = shouldUseCheapScoutForWebChat({ message: "dame ideas de captions" });
    assert.equal(route.tier, "cheap_scout");
    assert.equal(route.provider, "deepseek");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
