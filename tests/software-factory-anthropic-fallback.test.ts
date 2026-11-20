import test from "node:test";
import assert from "node:assert/strict";
import { APIError } from "@anthropic-ai/sdk";
import { createSharedOpenAiCreditLedger, type SharedCreditState } from "../server/shared-openai-credit-ledger";
import { createAnthropicFactoryTextProvider, createFactoryAnthropicTransport, anthropicUsageNanoUsd, type AnthropicFactoryClient } from "../server/software-factory-anthropic";
import { createAnthropicFactoryLedger, readAnthropicFactoryReservation, factoryAnthropicFallbackEnabled, factoryAnthropicMonthlyBudgetMicroUsd, loadAnthropicFactoryRuntime } from "../server/software-factory-anthropic-ledger";
import { runFactoryModelCall, factoryModelErrorLedger, factoryModelKeyRows, type FactoryModelRoute } from "../server/software-factory-model-routes";
import { resolveFactoryModelCredits } from "../server/software-factory-asistente-operator";
import { withFactoryApiParent } from "../server/factory-api-context";

const NOW = new Date("2026-11-19T12:00:00.000Z");
const now = () => NOW;
const signal = () => new AbortController().signal;

// ---- mocks (no network) ----
type Call = { kind: "count" | "stream"; params: any };
function mockClient(reply: { message?: any; countTokens?: number; streamError?: unknown; connectThenError?: unknown; countError?: unknown }) {
  const calls: Call[] = [];
  const client: AnthropicFactoryClient = {
    async countTokens(params) { calls.push({ kind: "count", params }); if (reply.countError) throw reply.countError; return { input_tokens: reply.countTokens ?? 1000 }; },
    stream(params) {
      calls.push({ kind: "stream", params });
      let connect = () => {};
      return { onConnect(listener) { connect = listener; },
        async finalMessage() { if (reply.streamError) throw reply.streamError; connect(); if (reply.connectThenError) throw reply.connectThenError; return reply.message; } };
    },
  };
  return { client, calls };
}
const message = (over: Record<string, unknown> = {}) => ({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_details: null,
  content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "{\"ok\":true}" }],
  usage: { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, iterations: null }, ...over });
const claudeConfig = (client: AnthropicFactoryClient) => ({ request: async () => { throw Error("unused"); }, model: "claude-opus-5-5", inputNanoUsdPerToken: 4000, outputNanoUsdPerToken: 20000,
  pricingValidUntil: "2027-05-19T00:00:00.000Z", now, maxInputTokens: 100000, effort: "high" as const, client });
const input = (maxCostCents = 100) => ({ instructions: "Return JSON.", text: "{\"task\":1}", maxOutputTokens: 4096, maxCostCents, signal: signal() });

function memoryStore() {
  const rows = new Map<string, string>();
  return { rows, read: async (owner: string) => rows.get(owner) ?? null,
    transact: async (owner: string, fn: (raw: string | null) => Promise<string>) => { const next = await fn(rows.get(owner) ?? null); rows.set(owner, next); return next; } };
}
function openAiLedger(availableMicroUsd = 5_000_000) {
  let state: SharedCreditState = { version: 1, grant: null, reservations: [], lastObservedAt: null };
  const ledger = createSharedOpenAiCreditLedger({ now, maximumGrantObservationAgeMs: 60000,
    grant: { id: "grant-1", accountScope: "openai-test", availableMicroUsd, observedAt: "2026-11-19T11:59:30.000Z", expiresAt: "2026-12-19T00:00:00.000Z", verificationEvidenceId: "evidence-1" },
    transact: async mutate => { const copy = structuredClone(state); const out = mutate(copy); state = copy; return out; } });
  return { ledger, get state() { return state; } };
}
// OpenAI Responses fake. mode: "complete" | "refusal" | "count-fails"
function openAiRequest(mode: "complete" | "refusal" | "count-fails") {
  let calls = 0;
  const request = async (url: string) => {
    calls++;
    if (url.endsWith("/input_tokens")) {
      if (mode === "count-fails") throw Error("FACTORY_API_OPERATION_UNPRICED");
      return Response.json({ object: "response.input_tokens", input_tokens: 10 });
    }
    const content = mode === "refusal" ? [{ type: "refusal", refusal: "no" }] : [{ type: "output_text", text: "{\"ok\":true}" }];
    return Response.json({ object: "response", model: "gpt-6-astra", status: "completed", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      output: [{ type: "message", role: "assistant", status: "completed", content }] });
  };
  return { request, get calls() { return calls; } };
}
const openAiModel = (request: (url: string, init: RequestInit) => Promise<Response>) => ({ request, model: "gpt-6-astra", inputNanoUsdPerToken: 1000, outputNanoUsdPerToken: 8000, pricingValidUntil: "2027-01-01T00:00:00.000Z", now, maxInputTokens: 100000 });
const callOptions = (key = "factory:test-key") => ({ key, input: input(), unknownError: "FACTORY_MODEL_OUTCOME_UNKNOWN",
  requestSha256: (m: { model: string }) => "a".repeat(63) + (m.model.startsWith("claude") ? "c" : "0"), evidenceId: (sha: string) => `factory-model:${sha}` });

// ---- provider ----
test("Claude provider sends adaptive thinking, explicit effort and default server-side fallbacks; settles from usage", async () => {
  const { client, calls } = mockClient({ message: message() });
  const result = await createAnthropicFactoryTextProvider(claudeConfig(client))(input());
  assert.equal(result.status, "completed");
  assert.equal(result.status === "completed" && result.text, "{\"ok\":true}");
  // 1000 * $4/M + 2000 * $20/M = $0.044 -> 5 cents (ceil)
  assert.equal(result.costCents, 5);
  const stream = calls.find(c => c.kind === "stream")!.params;
  assert.deepEqual(stream.thinking, { type: "adaptive" });
  assert.equal(stream.output_config.effort, "high");
  assert.deepEqual(stream.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(stream.fallbacks, "default");
  assert.equal(stream.model, "claude-opus-5-5");
  for (const banned of ["temperature", "top_p", "top_k", "tool_choice", "tools"]) assert.equal(banned in stream, false);
  assert.equal(stream.thinking.budget_tokens, undefined);
  assert.deepEqual(stream.messages.map((m: any) => m.role), ["user"]); // no assistant prefill
  assert.ok(stream.max_tokens >= 4096 && stream.max_tokens <= 16000);
  assert.equal(calls[0].kind, "count");
});

test("Claude refusal is checked before content and is a terminal failure that still settles cost", async () => {
  const { client } = mockClient({ message: message({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null }, content: [{ type: "text", text: "partial output" }] }) });
  const result = await createAnthropicFactoryTextProvider(claudeConfig(client))(input());
  assert.deepEqual(result, { status: "failed", reason: "FACTORY_ANTHROPIC_REFUSAL", costCents: 5, servedModel: "claude-opus-5-5" });
});

test("usage iterations price a declined attempt and a fallback attempt at each model's rate", () => {
  const usage = { input_tokens: 100, output_tokens: 1000, iterations: [
    { type: "message", model: "claude-opus-5-5", input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    { type: "fallback_message", model: "claude-opus-5", input_tokens: 100, output_tokens: 1000, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } ] };
  const settled = anthropicUsageNanoUsd({ model: "claude-opus-5", usage } as any, "claude-opus-5-5");
  // 100*4000 + 50*20000 + 100*5000 + 1000*25000 + 1000*500
  assert.equal(settled.nano, 400000n + 1000000n + 500000n + 25000000n + 500000n);
  assert.equal(settled.outputTokens, 1050);
  assert.throws(() => anthropicUsageNanoUsd({ model: "claude-opus-5-5", usage: { input_tokens: -1, output_tokens: 1 } } as any, "claude-opus-5-5"));
});

test("Claude provider blocks before streaming when the reserved cents cannot cover the worst case", async () => {
  const { client, calls } = mockClient({ message: message(), countTokens: 50000 });
  const result = await createAnthropicFactoryTextProvider(claudeConfig(client))(input(5));
  assert.deepEqual(result, { status: "blocked", reason: "FACTORY_ANTHROPIC_BUDGET_UNAVAILABLE", costCents: 0 });
  assert.equal(calls.some(c => c.kind === "stream"), false);
});

test("HTTP rejection before the stream connects is blocked; a failure after connect keeps the hold as unknown", async () => {
  const rejected = mockClient({ streamError: new APIError(429, { type: "error", error: { type: "rate_limit_error" } }, "rate", new Headers()) });
  assert.deepEqual(await createAnthropicFactoryTextProvider(claudeConfig(rejected.client))(input()), { status: "blocked", reason: "FACTORY_ANTHROPIC_RATE_LIMITED", costCents: 0 });
  const billing = mockClient({ streamError: new APIError(400, { type: "error", error: { type: "invalid_request_error" } }, "bad", new Headers()) });
  assert.equal((await createAnthropicFactoryTextProvider(claudeConfig(billing.client))(input())).status, "blocked");
  const midStream = mockClient({ connectThenError: new APIError(undefined, undefined, "dropped", undefined) });
  assert.deepEqual(await createAnthropicFactoryTextProvider(claudeConfig(midStream.client))(input()), { status: "unknown", reason: "FACTORY_ANTHROPIC_EXECUTION_UNCONFIRMED", costCents: 0 });
  const max = mockClient({ message: message({ stop_reason: "max_tokens" }) });
  assert.equal((await createAnthropicFactoryTextProvider(claudeConfig(max.client))(input())).status, "failed");
});

// ---- selection matrix (per call) ----
async function matrix(openAi: { request: ReturnType<typeof openAiRequest>; ledger?: ReturnType<typeof openAiLedger> }) {
  const oa = openAi.ledger ?? openAiLedger(); await oa.ledger.initialize().catch(() => undefined);
  const store = memoryStore(), claudeLedger = await createAnthropicFactoryLedger({ store, now, capMicroUsd: 50_000_000 });
  const claude = mockClient({ message: message() });
  const routes: FactoryModelRoute[] = [{ provider: "openai", ledger: oa.ledger, model: openAiModel(openAi.request.request) },
    { provider: "anthropic", ledger: claudeLedger, model: claudeConfig(claude.client) }];
  return { routes, claude, claudeLedger, oa };
}
test("selection: OpenAI success never touches Claude", async () => {
  const m = await matrix({ request: openAiRequest("complete") });
  const out = await runFactoryModelCall(m.routes, callOptions());
  assert.equal(out.provider, "openai"); assert.equal(out.result.status, "completed"); assert.equal(m.claude.calls.length, 0);
});
test("selection: OpenAI content refusal is returned, not retried on Claude", async () => {
  const m = await matrix({ request: openAiRequest("refusal") });
  const out = await runFactoryModelCall(m.routes, callOptions());
  assert.equal(out.provider, "openai"); assert.equal(out.result.status === "failed" && out.result.reason, "FACTORY_OPENAI_REFUSAL"); assert.equal(m.claude.calls.length, 0);
});
test("selection: OpenAI unavailable before submission falls back to Claude under the Claude ledger", async () => {
  const m = await matrix({ request: openAiRequest("count-fails") });
  const out = await runFactoryModelCall(m.routes, callOptions());
  assert.equal(out.provider, "anthropic"); assert.equal(out.model, "claude-opus-5-5"); assert.equal(out.result.status, "completed");
  const claudeStatus = await m.claudeLedger.status(), openStatus = await m.oa.ledger.status();
  assert.equal(claudeStatus.spentMicroUsd, 50000); // 5 cents settled on the Claude ledger
  assert.equal(openStatus.spentMicroUsd, 0);
  assert.equal(openStatus.reservedMicroUsd, 0);
});
test("selection: exhausted / uncertain OpenAI credit falls back; already-admitted key never does", async () => {
  const exhausted = await matrix({ request: openAiRequest("complete"), ledger: openAiLedger(1) });
  assert.equal((await runFactoryModelCall(exhausted.routes, callOptions())).provider, "anthropic");
  const uncertain = await matrix({ request: openAiRequest("complete") });
  await uncertain.oa.ledger.reserve({ key: "factory:other", consumer: "factory", requestSha256: "b".repeat(64), maximumMicroUsd: 10 });
  await uncertain.oa.ledger.markUnknown("factory:other", "unknown-1");
  assert.equal((await runFactoryModelCall(uncertain.routes, callOptions())).provider, "anthropic");
  const replay = await matrix({ request: openAiRequest("complete") });
  await runFactoryModelCall(replay.routes, callOptions("factory:same"));
  await assert.rejects(runFactoryModelCall(replay.routes, callOptions("factory:same")), (error: unknown) => {
    assert.equal((error as Error).message, "CREDIT_EXECUTION_ALREADY_ADMITTED"); assert.equal(factoryModelErrorLedger(error), replay.oa.ledger); return true; });
  assert.equal(replay.claude.calls.length, 0);
});
test("selection: an unknown OpenAI outcome is never retried on Claude", async () => {
  const oa = openAiLedger(); await oa.ledger.initialize();
  const claude = mockClient({ message: message() });
  let n = 0;
  const request = async (url: string) => { n++; if (url.endsWith("/input_tokens")) return Response.json({ object: "response.input_tokens", input_tokens: 10 }); throw Error("socket hang up"); };
  const routes: FactoryModelRoute[] = [{ provider: "openai", ledger: oa.ledger, model: openAiModel(request) },
    { provider: "anthropic", ledger: await createAnthropicFactoryLedger({ store: memoryStore(), now, capMicroUsd: 50_000_000 }), model: claudeConfig(claude.client) }];
  await assert.rejects(runFactoryModelCall(routes, callOptions()), /CREDIT_EXECUTION_UNCONFIRMED/);
  assert.equal(claude.calls.length, 0); assert.equal(n, 2);
});

// ---- Claude ledger ----
test("Claude ledger fails closed over the monthly cap, settles real usage, and keeps spend when the cap changes", async () => {
  const store = memoryStore();
  const ledger = await createAnthropicFactoryLedger({ store, now, capMicroUsd: 1_000_000 });
  await assert.rejects(ledger.reserve({ key: "k-over", consumer: "factory", requestSha256: "c".repeat(64), maximumMicroUsd: 1_000_001 }), /CREDIT_UNAVAILABLE/);
  assert.equal((await ledger.reserve({ key: "k1", consumer: "factory", requestSha256: "c".repeat(64), maximumMicroUsd: 600_000 })).admitted, true);
  await ledger.settle({ key: "k1", actualMicroUsd: 400_000, evidenceId: "e1" });
  assert.equal((await ledger.status()).availableMicroUsd, 600_000);
  assert.deepEqual([...store.rows.keys()], [JSON.stringify(["factory-anthropic-budget-ledger-v2", "factory-anthropic"])]);
  const lowered = await createAnthropicFactoryLedger({ store, now, capMicroUsd: 300_000 });
  assert.equal((await lowered.status()).availableMicroUsd, 0);
  await assert.rejects(lowered.reserve({ key: "k2", consumer: "factory", requestSha256: "c".repeat(64), maximumMicroUsd: 1 }), /CREDIT_UNAVAILABLE/);
  assert.equal((await readAnthropicFactoryReservation(store, "k1"))?.status, "settled");
  assert.equal(await readAnthropicFactoryReservation(memoryStore(), "k1"), null);
});
test("Claude ledger month rollover: new cap for settled history, but holds, unknowns and receipts survive", async () => {
  const store = memoryStore();
  const nov = await createAnthropicFactoryLedger({ store, now, capMicroUsd: 1_000_000 });
  await nov.reserve({ key: "settled-nov", consumer: "factory", requestSha256: "c".repeat(64), maximumMicroUsd: 900_000 });
  await nov.settle({ key: "settled-nov", actualMicroUsd: 900_000, evidenceId: "e-nov" });
  await nov.reserve({ key: "held-nov", consumer: "factory", requestSha256: "c".repeat(64), maximumMicroUsd: 50_000 });
  // A process that crosses the boundary fails closed until restarted.
  let at = NOW; const moving = await createAnthropicFactoryLedger({ store, now: () => at, capMicroUsd: 1_000_000 });
  at = new Date("2026-12-01T00:00:01.000Z");
  // ...but a call admitted in November still settles after midnight.
  await nov.reserve({ key: "straddle", consumer: "factory", requestSha256: "c".repeat(64), maximumMicroUsd: 10_000 });
  await assert.rejects(moving.reserve({ key: "late", consumer: "factory", requestSha256: "c".repeat(64), maximumMicroUsd: 1 }), /CREDIT_EXPIRED/);
  await assert.rejects(moving.executionWindow("straddle", 300000), /CREDIT_EXPIRED/);
  await moving.settle({ key: "straddle", actualMicroUsd: 5_000, evidenceId: "e-straddle" });
  assert.equal((await moving.status()).spentMicroUsd, 905_000);
  const dec = await createAnthropicFactoryLedger({ store, now: () => at, capMicroUsd: 1_000_000 });
  const status = await dec.status();
  assert.equal(status.availableMicroUsd, 950_000); // November spend (incl. the straddling call) is outside December's cap; the open hold still counts
  await dec.markUnknown("held-nov", "unknown-nov");
  await assert.rejects(dec.reserve({ key: "new-dec", consumer: "factory", requestSha256: "c".repeat(64), maximumMicroUsd: 1 }), /CREDIT_RECONCILIATION_REQUIRED/);
  // A key from an earlier month is never admitted again.
  assert.equal((await dec.reserve({ key: "settled-nov", consumer: "factory", requestSha256: "c".repeat(64), maximumMicroUsd: 900_000 })).admitted, false);
});
test("Claude flag defaults on only with a key; budget env defaults to $50 and rejects invalid values", async () => {
  assert.equal(factoryAnthropicFallbackEnabled({}), false);
  assert.equal(factoryAnthropicFallbackEnabled({ FACTORY_ANTHROPIC_FALLBACK_ENABLED: "true" }), false);
  assert.equal(factoryAnthropicFallbackEnabled({ ANTHROPIC_API_KEY: "sk-ant-x" }), true);
  assert.equal(factoryAnthropicFallbackEnabled({ ANTHROPIC_API_KEY: "sk-ant-x", FACTORY_ANTHROPIC_FALLBACK_ENABLED: "false" }), false);
  assert.equal(factoryAnthropicMonthlyBudgetMicroUsd({}), 50_000_000);
  assert.equal(factoryAnthropicMonthlyBudgetMicroUsd({ FACTORY_ANTHROPIC_MONTHLY_BUDGET_USD: "" }), 50_000_000);
  assert.throws(() => factoryAnthropicMonthlyBudgetMicroUsd({ FACTORY_ANTHROPIC_MONTHLY_BUDGET_USD: "lots" }), /BUDGET_INVALID/);
  await assert.rejects(loadAnthropicFactoryRuntime({}, now, memoryStore()), /FALLBACK_DISABLED/);
});

// ---- startup selection ----
test("startup: without Claude the OpenAI error is unchanged; with Claude an uncertain OpenAI credit runs on Claude", async () => {
  const uncertainOpenAi = async () => { const oa = openAiLedger(); await oa.ledger.initialize(); await oa.ledger.reserve({ key: "x", consumer: "factory", requestSha256: "d".repeat(64), maximumMicroUsd: 1 }); await oa.ledger.markUnknown("x", "u");
    return { credits: { ledger: oa.ledger, pricing: { model: "gpt-6-astra", inputNanoUsdPerToken: 1, outputNanoUsdPerToken: 1, validUntil: "2027-01-01T00:00:00.000Z" } }, createRequest: () => async () => new Response() }; };
  const claude = (cap: number) => async () => { const r = await loadAnthropicFactoryRuntime({ ANTHROPIC_API_KEY: "sk-ant-x", FACTORY_ANTHROPIC_MONTHLY_BUDGET_USD: String(cap) }, now, memoryStore()); return { credits: r, modelRequest: async () => new Response() }; };
  await assert.rejects(resolveFactoryModelCredits({ env: {}, now, requiredMicroUsd: 1_000_000, loadOpenAi: uncertainOpenAi, loadAnthropic: claude(50) }), /FACTORY_OPERATOR_CREDIT_UNCERTAIN/);
  const selected = await resolveFactoryModelCredits({ env: { ANTHROPIC_API_KEY: "sk-ant-x" }, now, requiredMicroUsd: 1_000_000, loadOpenAi: uncertainOpenAi, loadAnthropic: claude(50) });
  assert.equal(selected.provider, "anthropic"); assert.equal(selected.credits.pricing.model, "claude-opus-5-5");
  const missing = await resolveFactoryModelCredits({ env: { ANTHROPIC_API_KEY: "sk-ant-x" }, now, requiredMicroUsd: 1_000_000, loadOpenAi: async () => { throw Error("CREDIT_RUNTIME_CONFIGURATION_REQUIRED"); }, loadAnthropic: claude(50) });
  assert.equal(missing.provider, "anthropic");
  await assert.rejects(resolveFactoryModelCredits({ env: { ANTHROPIC_API_KEY: "sk-ant-x" }, now, requiredMicroUsd: 1_000_000, loadOpenAi: uncertainOpenAi, loadAnthropic: claude(0.5) }), /FACTORY_ANTHROPIC_CREDIT_INSUFFICIENT/);
  const healthy = async () => { const oa = openAiLedger(); await oa.ledger.initialize(); return { credits: { ledger: oa.ledger, pricing: { model: "gpt-6-astra", inputNanoUsdPerToken: 1, outputNanoUsdPerToken: 1, validUntil: "2027-01-01T00:00:00.000Z" } }, createRequest: () => async () => new Response() }; };
  const both = await resolveFactoryModelCredits({ env: { ANTHROPIC_API_KEY: "sk-ant-x" }, now, requiredMicroUsd: 1_000_000, loadOpenAi: healthy, loadAnthropic: claude(50) });
  assert.equal(both.provider, "openai"); assert.ok("fallback" in both && both.fallback);
  const noClaude = await resolveFactoryModelCredits({ env: { ANTHROPIC_API_KEY: "sk-ant-x" }, now, requiredMicroUsd: 1_000_000, loadOpenAi: healthy, loadAnthropic: async () => { throw Error("db down"); } });
  assert.equal(noClaude.provider, "openai"); assert.equal("fallback" in noClaude, false);
});

// ---- transport ----
test("Claude transport is scoped to Messages endpoints inside a claimed Factory job and injects the key", async () => {
  const seen: { url: string; headers: Headers }[] = [];
  const request = createFactoryAnthropicTransport("sk-ant-" + "a".repeat(30), (async (url: string, init: RequestInit) => { seen.push({ url, headers: new Headers(init.headers) }); return Response.json({}); }) as typeof fetch);
  const init = { method: "POST", body: "{}", headers: { "x-api-key": "factory-transport-injected" } };
  await assert.rejects(request("https://api.anthropic.com/v1/messages", init), /PARENT_CONTEXT_UNAVAILABLE/);
  const job = { id: "job-1", ownerKey: "o", fence: "f", status: "running" } as any;
  await withFactoryApiParent(job, async () => {
    await assert.rejects(request("https://evil.example/v1/messages", init), /SCOPE_INVALID/);
    await assert.rejects(request("https://api.anthropic.com/v1/files", init), /SCOPE_INVALID/);
    await request("https://api.anthropic.com/v1/messages?beta=true", init);
  });
  assert.equal(seen.length, 1); assert.equal(seen[0].headers.get("x-api-key"), "sk-ant-" + "a".repeat(30));
  assert.throws(() => createFactoryAnthropicTransport("not-a-key"), /CREDENTIAL_REQUIRED/);
});

// ---- review fixes ----
const sse = (events: object[]) => events.map(e => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
test("real SDK path: Claude requests get a 300 s execution window (OpenAI keeps 120 s) and stream through finalMessage", async () => {
  const oa = openAiLedger(); await oa.ledger.initialize();
  const claudeLedger = await createAnthropicFactoryLedger({ store: memoryStore(), now, capMicroUsd: 50_000_000 });
  const windows: { provider: string; maxMs: number | undefined }[] = [];
  const spy = (ledger: typeof oa.ledger, provider: string) => new Proxy(ledger, { get(target, prop) {
    if (prop === "executionWindow") return async (key: string, maxMs?: number) => { windows.push({ provider, maxMs }); return target.executionWindow(key, maxMs); };
    return Reflect.get(target, prop); } });
  const urls: string[] = [];
  const claudeFetch = async (url: string) => {
    urls.push(url);
    if (url.includes("count_tokens")) return Response.json({ input_tokens: 1000 });
    return new Response(sse([
      { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, stop_details: null, usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "{\"ok\":true}" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null, stop_details: null }, usage: { output_tokens: 2000 } },
      { type: "message_stop" }]), { headers: { "content-type": "text/event-stream" } });
  };
  const { client: _unused, ...claudeModel } = claudeConfig(mockClient({}).client);
  const routes: FactoryModelRoute[] = [{ provider: "openai", ledger: spy(oa.ledger, "openai"), model: openAiModel(openAiRequest("count-fails").request) },
    { provider: "anthropic", ledger: spy(claudeLedger, "anthropic"), model: { ...claudeModel, request: claudeFetch } }];
  const out = await runFactoryModelCall(routes, callOptions("factory:window"));
  assert.equal(out.provider, "anthropic"); assert.equal(out.result.status, "completed"); assert.equal(out.result.costCents, 5);
  assert.deepEqual(windows, [{ provider: "openai", maxMs: 120000 }, { provider: "anthropic", maxMs: 300000 }, { provider: "anthropic", maxMs: 300000 }]);
  assert.ok(urls[0].includes("/v1/messages/count_tokens") && urls[1].includes("/v1/messages"));
  await assert.rejects(oa.ledger.executionWindow("factory:none", 600001), /CONFIGURATION_INVALID/);
});
test("integrity failures on the OpenAI ledger halt instead of switching to Claude (per call and at startup)", async () => {
  const claude = mockClient({ message: message() });
  const corrupt = { ...openAiLedger().ledger, reservation: async () => null, reserve: async () => { throw Error("CREDIT_CORRUPT"); } } as any;
  const routes: FactoryModelRoute[] = [{ provider: "openai", ledger: corrupt, model: openAiModel(openAiRequest("complete").request) },
    { provider: "anthropic", ledger: await createAnthropicFactoryLedger({ store: memoryStore(), now, capMicroUsd: 50_000_000 }), model: claudeConfig(claude.client) }];
  for (const code of ["CREDIT_CORRUPT", "CREDIT_GRANT_MISMATCH", "CREDIT_STORAGE_NOT_PROVISIONED"]) {
    corrupt.reserve = async () => { throw Error(code); };
    await assert.rejects(runFactoryModelCall(routes, callOptions()), new RegExp(code));
  }
  assert.equal(claude.calls.length, 0);
  const loadAnthropic = async () => { throw Error("must not load"); };
  for (const code of ["CREDIT_CORRUPT", "CREDIT_STORAGE_NOT_PROVISIONED", "CREDIT_RUNTIME_CONFIGURATION_INVALID"])
    await assert.rejects(resolveFactoryModelCredits({ env: { ANTHROPIC_API_KEY: "sk-ant-x" }, now, requiredMicroUsd: 1, loadOpenAi: async () => { throw Error(code); }, loadAnthropic }), new RegExp(code));
});
test("a key already on another route's ledger is never executed on a second provider", async () => {
  const m = await matrix({ request: openAiRequest("complete") });
  await m.claudeLedger.reserve({ key: "factory:held", consumer: "factory", requestSha256: "e".repeat(64), maximumMicroUsd: 1 });
  await assert.rejects(runFactoryModelCall(m.routes, callOptions("factory:held")), (error: unknown) => {
    assert.equal((error as Error).message, "CREDIT_EXECUTION_ALREADY_ADMITTED"); assert.equal(factoryModelErrorLedger(error), m.claudeLedger); return true; });
  assert.equal((await m.oa.ledger.status()).reservedMicroUsd, 0);
  assert.equal(m.claude.calls.length, 0);
  const rows = await factoryModelKeyRows(m.routes, "factory:held");
  assert.deepEqual(rows.map(r => [r.provider, r.row.status]), [["anthropic", "reserved"]]);
});
test("Claude usage above the reservation is unverified: the hold stays unknown", async () => {
  const { client } = mockClient({ message: message({ usage: { input_tokens: 1000, output_tokens: 60000, iterations: null } }) });
  assert.deepEqual(await createAnthropicFactoryTextProvider(claudeConfig(client))(input()), { status: "unknown", reason: "FACTORY_ANTHROPIC_EXECUTION_UNCONFIRMED", costCents: 0 });
});
test("startup surfaces the real code-owned Claude cause instead of a generic code", async () => {
  const uncertain = async () => { throw Error("FACTORY_OPERATOR_CREDIT_UNCERTAIN"); };
  await assert.rejects(resolveFactoryModelCredits({ env: { ANTHROPIC_API_KEY: "sk-ant-x" }, now, requiredMicroUsd: 1, loadOpenAi: uncertain, loadAnthropic: async () => { throw Error("FACTORY_ANTHROPIC_STORAGE_REQUIRED"); } }), /^Error: FACTORY_ANTHROPIC_STORAGE_REQUIRED$/);
  await assert.rejects(resolveFactoryModelCredits({ env: { ANTHROPIC_API_KEY: "sk-ant-x" }, now, requiredMicroUsd: 1, loadOpenAi: uncertain, loadAnthropic: async () => { throw Error("CREDIT_CLOCK_UNVERIFIED"); } }), /FACTORY_ANTHROPIC_CREDIT_CLOCK_UNVERIFIED/);
  await assert.rejects(resolveFactoryModelCredits({ env: { ANTHROPIC_API_KEY: "sk-ant-x" }, now, requiredMicroUsd: 1, loadOpenAi: uncertain, loadAnthropic: async () => { throw Error("secret text https://x"); } }), /^Error: FACTORY_ANTHROPIC_FALLBACK_UNAVAILABLE$/);
});
test("OpenAI monetary-gate refusal before dispatch is a zero-cost block that falls back; a dispatched failure is unknown", async () => {
  const { FactoryApiBudgetError } = await import("../server/factory-api-invocation");
  const gated = (error: Error) => async (url: string) => { if (url.endsWith("/input_tokens")) return Response.json({ object: "response.input_tokens", input_tokens: 10 }); throw error; };
  const m = await matrix({ request: { request: gated(new FactoryApiBudgetError("FACTORY_API_BUDGET_EXHAUSTED")), calls: 0 } as any });
  const out = await runFactoryModelCall(m.routes, callOptions("factory:gate"));
  assert.equal(out.provider, "anthropic");
  assert.equal((await m.oa.ledger.reservation("factory:gate"))?.actualMicroUsd, 0);
  const d = await matrix({ request: { request: gated(new FactoryApiBudgetError("FACTORY_API_EXECUTION_UNCONFIRMED", true)), calls: 0 } as any });
  await assert.rejects(runFactoryModelCall(d.routes, callOptions("factory:dispatched")), /CREDIT_EXECUTION_UNCONFIRMED/);
  assert.equal(d.claude.calls.length, 0);
});

test("follow-ups: missing OpenAI key keeps the OpenAI ledger as history; Claude-only runs check it per call", async () => {
  const oa = openAiLedger(); await oa.ledger.initialize();
  const loadOpenAi = async () => ({ credits: { ledger: oa.ledger, pricing: { model: "gpt-6-astra", inputNanoUsdPerToken: 1, outputNanoUsdPerToken: 1, validUntil: "2027-01-01T00:00:00.000Z" } },
    createRequest: (): never => { throw Error("FACTORY_OPENAI_CREDENTIAL_REQUIRED"); } });
  const claudeLoad = async () => ({ credits: await loadAnthropicFactoryRuntime({ ANTHROPIC_API_KEY: "sk-ant-x" }, now, memoryStore()), modelRequest: async () => new Response() });
  const selected = await resolveFactoryModelCredits({ env: { ANTHROPIC_API_KEY: "sk-ant-x" }, now, requiredMicroUsd: 1, loadOpenAi, loadAnthropic: claudeLoad });
  assert.equal(selected.provider, "anthropic");
  assert.deepEqual("priorLedgers" in selected ? selected.priorLedgers : undefined, [oa.ledger]);
  // Claude-only route: a key already on the OpenAI ledger is never executed on Claude.
  await oa.ledger.reserve({ key: "factory:openai-held", consumer: "factory", requestSha256: "f".repeat(64), maximumMicroUsd: 1 });
  const claude = mockClient({ message: message() });
  const route: FactoryModelRoute = { provider: "anthropic", ledger: selected.credits.ledger, model: claudeConfig(claude.client), historyLedgers: [oa.ledger] };
  await assert.rejects(runFactoryModelCall([route], callOptions("factory:openai-held")), (error: unknown) => {
    assert.equal((error as Error).message, "CREDIT_EXECUTION_ALREADY_ADMITTED"); assert.equal(factoryModelErrorLedger(error), oa.ledger); return true; });
  assert.equal(claude.calls.length, 0);
  assert.deepEqual((await factoryModelKeyRows([route], "factory:openai-held")).map(r => r.provider), ["history"]);
  assert.equal((await runFactoryModelCall([route], callOptions("factory:fresh"))).provider, "anthropic");
});
test("pacer + Claude ledger: monthly view (cap / current UTC month) admits a $1 order on day 19 and refuses once the month is used", async () => {
  const { createCreditPacer } = await import("../server/credit-pacer-runtime");
  const store = memoryStore();
  // Spend from an earlier month never counts against this month's pace.
  const oct = await createAnthropicFactoryLedger({ store, now: () => new Date("2026-10-20T12:00:00.000Z"), capMicroUsd: 50_000_000 });
  await oct.reserve({ key: "oct", consumer: "factory", requestSha256: "c".repeat(64), maximumMicroUsd: 45_000_000 });
  await oct.settle({ key: "oct", actualMicroUsd: 45_000_000, evidenceId: "e-oct" });
  await oct.reserve({ key: "oct-held", consumer: "factory", requestSha256: "c".repeat(64), maximumMicroUsd: 100_000 }); // still open: counts
  const ledger = await createAnthropicFactoryLedger({ store, now, capMicroUsd: 50_000_000 });
  const snapshot = await ledger.paceSnapshot();
  assert.equal(snapshot.observedAt, "2026-11-01T00:00:00.000Z"); assert.equal(snapshot.expiresAt, "2026-12-01T00:00:00.000Z");
  assert.equal(snapshot.grantMicroUsd, 50_000_000); assert.deepEqual(snapshot.rows.map(r => r.status), ["reserved"]); assert.equal(snapshot.ledgerId, "factory-anthropic");
  const pacer = () => createCreditPacer({ readSnapshot: () => ledger.paceSnapshot(), now: () => NOW.getTime(), cacheMs: 0 });
  const allowed = await pacer().allow("standard", "self_heal_order", 1_000_000);
  assert.equal(allowed.allowed, true, allowed.reason);
  // Use up the month: settled spend this month plus an older open hold.
  await ledger.reserve({ key: "nov", consumer: "factory", requestSha256: "c".repeat(64), maximumMicroUsd: 49_400_000 });
  await ledger.settle({ key: "nov", actualMicroUsd: 49_400_000, evidenceId: "e-nov" });
  assert.equal((await ledger.paceSnapshot()).rows.length, 2);
  const refused = await pacer().allow("standard", "self_heal_order", 1_000_000);
  assert.equal(refused.allowed, false);
});
