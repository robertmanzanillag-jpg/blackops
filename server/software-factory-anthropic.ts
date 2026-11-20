import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, BetaMessageStreamParams, MessageCountTokensParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { currentFactoryApiParent } from "./factory-api-context";
import type { FactoryTextResult } from "./software-factory-openai";

/** Claude fallback for Software Factory model calls. Anthropic-only code lives
 * here; OpenAI files never import the Anthropic SDK. */
export const ANTHROPIC_FACTORY_MODEL = "claude-opus-5-5";
export const ANTHROPIC_FACTORY_FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Integer nanodollars per token ($1 per million tokens = 1000). Claude Opus 5.5
 * list price verified 2026-11-19: $4/M input, $20/M output, $0.20/M cache reads.
 * Server-side refusal fallbacks ("default") may rerun a declined request on
 * claude-opus-5 or claude-opus-4-8, billed at that model's $5/M / $25/M rates.
 * Any model not listed here is settled at the highest listed rate. */
export const ANTHROPIC_FACTORY_PRICES: Readonly<Record<string, Readonly<{ input: number; output: number; cacheRead: number; cacheWrite: number }>>> = Object.freeze({
  "claude-opus-5-5": Object.freeze({ input: 4000, output: 20000, cacheRead: 200, cacheWrite: 5000 }),
  "claude-opus-5": Object.freeze({ input: 5000, output: 25000, cacheRead: 500, cacheWrite: 6250 }),
  "claude-opus-4-8": Object.freeze({ input: 5000, output: 25000, cacheRead: 500, cacheWrite: 6250 }),
});
/** Operator pricing must be re-verified by this date or calls block. */
export const ANTHROPIC_FACTORY_PRICING_VALID_UNTIL = "2027-05-19T00:00:00.000Z";
const MAX_PRICE = Object.freeze(Object.values(ANTHROPIC_FACTORY_PRICES).reduce((a, b) => ({
  input: Math.max(a.input, b.input), output: Math.max(a.output, b.output), cacheRead: Math.max(a.cacheRead, b.cacheRead), cacheWrite: Math.max(a.cacheWrite, b.cacheWrite) })));
const priceFor = (model: unknown) => (typeof model === "string" && Object.hasOwn(ANTHROPIC_FACTORY_PRICES, model) ? ANTHROPIC_FACTORY_PRICES[model] : MAX_PRICE);

/** Narrow client surface: count tokens and stream one message. Tests inject a
 * mock; production uses createAnthropicFactoryClient. */
export interface AnthropicFactoryClient {
  countTokens(params: MessageCountTokensParams, options: { signal: AbortSignal }): Promise<{ input_tokens: number }>;
  stream(params: BetaMessageStreamParams, options: { signal: AbortSignal }): { onConnect(listener: () => void): void; finalMessage(): Promise<BetaMessage> };
}

/** The SDK never sees the real key; the authority transport injects it. No
 * SDK retries: a retried paid call could be billed twice. */
export function createAnthropicFactoryClient(request: (url: string, init: RequestInit) => Promise<Response>, timeoutMs: number): AnthropicFactoryClient {
  const client = new Anthropic({ apiKey: "factory-transport-injected", maxRetries: 0, timeout: timeoutMs,
    fetch: async (url, init) => request(String(url), init ?? {}) });
  return {
    countTokens: (params, options) => client.beta.messages.countTokens(params, options),
    stream: (params, options) => {
      const stream = client.beta.messages.stream(params, options);
      return { onConnect: listener => { stream.on("connect", listener); }, finalMessage: () => stream.finalMessage() };
    },
  };
}

/** Credential stays in this closure. Only the two priced Messages endpoints, only
 * inside a claimed Factory job, no redirects, no ambient cookies. */
export function createFactoryAnthropicTransport(key: string, transport: typeof fetch = fetch) {
  if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(key)) throw Error("FACTORY_ANTHROPIC_CREDENTIAL_REQUIRED");
  return async (url: string, init: RequestInit): Promise<Response> => {
    let target: URL;
    try { target = new URL(url); } catch { throw Error("FACTORY_ANTHROPIC_TRANSPORT_SCOPE_INVALID"); }
    if (target.origin !== "https://api.anthropic.com" || target.username || target.password || target.hash ||
      !["/v1/messages", "/v1/messages/count_tokens"].includes(target.pathname) || !["", "?beta=true"].includes(target.search) ||
      String(init.method).toUpperCase() !== "POST" || typeof init.body !== "string" || !init.body || Buffer.byteLength(init.body) > 1048576) throw Error("FACTORY_ANTHROPIC_TRANSPORT_SCOPE_INVALID");
    if (!currentFactoryApiParent()) throw Error("FACTORY_ANTHROPIC_PARENT_CONTEXT_UNAVAILABLE");
    init.signal?.throwIfAborted();
    const headers = new Headers(init.headers);
    headers.delete("authorization"); headers.set("x-api-key", key);
    return transport(target.href, { method: "POST", body: init.body, headers, signal: init.signal, redirect: "error", credentials: "omit" });
  };
}

export type AnthropicFactoryModelConfig = {
  request: (url: string, init: RequestInit) => Promise<Response>;
  model: string;
  inputNanoUsdPerToken: number; outputNanoUsdPerToken: number;
  pricingValidUntil: string; now: () => Date; maxInputTokens: number;
  timeoutMs?: number;
  /** Explicit (the model default is medium). Code generation uses high. */
  effort?: "medium" | "high" | "xhigh";
  /** Upper bound for max_tokens (default 16000 so a high-effort stream fits
   * the 300 s execution window comfortably). Adaptive thinking shares max_tokens with the
   * answer, so the call may use up to this many tokens if the reserved budget
   * covers them; it is never lower than the caller's maxOutputTokens. */
  maxTokensCeiling?: number;
  /** Test injection only. */
  client?: AnthropicFactoryClient;
};
export type AnthropicFactoryTextResult = FactoryTextResult & { servedModel?: string };

type UsageLike = { input_tokens?: unknown; output_tokens?: unknown; cache_read_input_tokens?: unknown; cache_creation_input_tokens?: unknown };
const tokens = (value: unknown) => (value === null || value === undefined ? 0 : value);
const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** Settle from the response's own usage. usage.iterations is the per-attempt
 * billing source when present (it includes declined attempts and fallback
 * attempts at the fallback model's rates); otherwise the top-level usage is
 * priced at the serving model's rate. Throws when usage is unverifiable. */
export function anthropicUsageNanoUsd(message: Pick<BetaMessage, "model" | "usage">, requestedModel: string) {
  const usage = message.usage as (UsageLike & { iterations?: unknown }) | undefined;
  if (!usage || typeof usage !== "object") throw Error("usage");
  const rows: { model: unknown; usage: UsageLike }[] = Array.isArray(usage.iterations) && usage.iterations.length
    ? usage.iterations.map((row: { type?: unknown; model?: unknown } & UsageLike) => ({ model: row?.type === "message" ? (row.model ?? requestedModel) : row?.model, usage: row }))
    : [{ model: message.model, usage }];
  let nano = 0n, input = 0, output = 0;
  for (const row of rows) {
    const u = row.usage, values = [u.input_tokens, u.output_tokens, tokens(u.cache_read_input_tokens), tokens(u.cache_creation_input_tokens)];
    if (!values.every(count)) throw Error("usage");
    const [i, o, read, write] = values as number[], price = priceFor(row.model);
    nano += BigInt(i) * BigInt(price.input) + BigInt(o) * BigInt(price.output) + BigInt(read) * BigInt(price.cacheRead) + BigInt(write) * BigInt(price.cacheWrite);
    input += i + read + write; output += o;
  }
  return { nano, inputTokens: input, outputTokens: output };
}
const centsFromNano = (nano: bigint) => Number((nano + 9999999n) / 10000000n);

/** Same contract as createOpenAiFactoryTextProvider: stateless text, caller
 * reserves maxCostCents first and keeps the hold on "unknown". */
export function createAnthropicFactoryTextProvider(config: AnthropicFactoryModelConfig) {
  const c = { ...config }, timeout = c.timeoutMs ?? 300000, ceiling = c.maxTokensCeiling ?? 16000, effort = c.effort ?? "high";
  const positive = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
  const expiry = Date.parse(c.pricingValidUntil), listed = ANTHROPIC_FACTORY_PRICES[c.model];
  if (typeof c.request !== "function" || typeof c.now !== "function" || !listed || c.inputNanoUsdPerToken !== listed.input || c.outputNanoUsdPerToken !== listed.output ||
    !positive(c.maxInputTokens) || !Number.isFinite(expiry) || !positive(timeout) || timeout > 600000 || !positive(ceiling) || ceiling > 128000 || !["medium", "high", "xhigh"].includes(effort))
    throw Error("FACTORY_ANTHROPIC_CONFIGURATION_INVALID");
  const client = c.client ?? createAnthropicFactoryClient(c.request, timeout);
  return async function generateText(raw: { instructions: string; text: string; maxOutputTokens: number; maxCostCents: number; signal: AbortSignal; responseSchema?: { name: string; schema: Record<string, unknown> } }): Promise<AnthropicFactoryTextResult> {
    const input = { ...raw };
    const blocked = (reason: string): AnthropicFactoryTextResult => ({ status: "blocked", reason, costCents: 0 });
    let schema: Record<string, unknown> | undefined;
    if (input.responseSchema !== undefined) {
      const r = input.responseSchema; let encoded = "";
      try { encoded = JSON.stringify(r?.schema); } catch { encoded = ""; }
      if (!r || typeof r.name !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(r.name) || !r.schema || typeof r.schema !== "object" || Array.isArray(r.schema) || !encoded || Buffer.byteLength(encoded) > 16384) return blocked("FACTORY_ANTHROPIC_INPUT_INVALID");
      schema = JSON.parse(encoded);
    }
    if (typeof input.instructions !== "string" || typeof input.text !== "string" || !input.text.trim() || Buffer.byteLength(input.instructions) + Buffer.byteLength(input.text) > 262144 ||
      !positive(input.maxOutputTokens) || input.maxOutputTokens < 16 || input.maxOutputTokens > 128000 || !positive(input.maxCostCents) || input.maxCostCents > 10000 || !input.signal) return blocked("FACTORY_ANTHROPIC_INPUT_INVALID");
    const fresh = () => { const now = c.now().getTime(); return Number.isFinite(now) && now < expiry; };
    if (!fresh()) return blocked("FACTORY_ANTHROPIC_PRICING_EXPIRED");
    if (input.signal.aborted) return blocked("FACTORY_ANTHROPIC_CANCELLED");
    const controller = new AbortController(), abort = () => controller.abort();
    input.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeout);
    let submitted = false, connected = false;
    try {
      // No assistant prefill, sampling parameters, thinking budget or tools.
      const base = { model: c.model, system: input.instructions, messages: [{ role: "user" as const, content: input.text }],
        thinking: { type: "adaptive" as const }, output_config: { effort, ...(schema ? { format: { type: "json_schema" as const, schema } } : {}) } };
      const counted = await client.countTokens(base, { signal: controller.signal });
      if (!count(counted?.input_tokens) || counted.input_tokens > c.maxInputTokens) return blocked("FACTORY_ANTHROPIC_COUNT_INVALID");
      // Worst case = the requested attempt plus one server-side fallback attempt,
      // both at full max_tokens. The fallback attempt is priced at the max rate.
      const budget = BigInt(input.maxCostCents) * 10000000n, inputNano = BigInt(counted.input_tokens) * BigInt(listed.input + MAX_PRICE.input);
      const perOutput = BigInt(listed.output + MAX_PRICE.output), affordable = budget > inputNano ? (budget - inputNano) / perOutput : 0n;
      if (affordable < BigInt(input.maxOutputTokens)) return blocked("FACTORY_ANTHROPIC_BUDGET_UNAVAILABLE");
      const maxTokens = Math.max(input.maxOutputTokens, Math.min(ceiling, Number(affordable)));
      if (!fresh() || controller.signal.aborted) return blocked("FACTORY_ANTHROPIC_ADMISSION_EXPIRED");
      submitted = true;
      const stream = client.stream({ ...base, max_tokens: maxTokens, betas: [ANTHROPIC_FACTORY_FALLBACK_BETA], fallbacks: "default" }, { signal: controller.signal });
      stream.onConnect(() => { connected = true; });
      const message = await stream.finalMessage();
      if (controller.signal.aborted) throw Error("cancelled");
      if (message?.type !== "message" || message.role !== "assistant" || !Array.isArray(message.content)) throw Error("shape");
      const settled = anthropicUsageNanoUsd(message, c.model), costCents = centsFromNano(settled.nano);
      // Like the OpenAI provider: usage beyond the reservation is unverified, so
      // the caller keeps the full hold as unknown for reconciliation.
      if (!Number.isSafeInteger(costCents) || costCents > input.maxCostCents) throw Error("usage bounds");
      const servedModel = typeof message.model === "string" ? message.model : c.model;
      // Refusal first: its content is not an answer (pre-output refusals are empty).
      if (message.stop_reason === "refusal") return { status: "failed", reason: "FACTORY_ANTHROPIC_REFUSAL", costCents, servedModel };
      if (message.stop_reason === "max_tokens") return { status: "failed", reason: "FACTORY_ANTHROPIC_OUTPUT_LIMIT", costCents, servedModel };
      if (message.stop_reason === "model_context_window_exceeded") return { status: "failed", reason: "FACTORY_ANTHROPIC_INCOMPLETE", costCents, servedModel };
      if (message.stop_reason !== "end_turn" && message.stop_reason !== "stop_sequence") return { status: "failed", reason: "FACTORY_ANTHROPIC_NOT_COMPLETED", costCents, servedModel };
      let text = "";
      for (const block of message.content) {
        if (block.type === "thinking" || block.type === "redacted_thinking" || block.type === "fallback") continue;
        if (block.type !== "text" || typeof block.text !== "string") return { status: "failed", reason: "FACTORY_ANTHROPIC_NOT_COMPLETED", costCents, servedModel };
        text += block.text;
      }
      if (!text.trim()) return { status: "failed", reason: "FACTORY_ANTHROPIC_EMPTY_TEXT", costCents, servedModel };
      return { status: "completed", text, costCents, inputTokens: settled.inputTokens, outputTokens: settled.outputTokens, servedModel };
    } catch (error) {
      if (!submitted) return blocked("FACTORY_ANTHROPIC_COUNT_UNAVAILABLE");
      // An HTTP error status before the stream connected means the request was
      // rejected and not executed. Anything else may have been billed.
      if (!connected && error instanceof Anthropic.APIError && typeof error.status === "number") {
        const s = error.status;
        if (s === 401 || s === 403) return blocked("FACTORY_ANTHROPIC_CREDENTIAL_REJECTED");
        if (s === 429) return blocked("FACTORY_ANTHROPIC_RATE_LIMITED");
        if (s === 529) return blocked("FACTORY_ANTHROPIC_OVERLOADED");
        if (s >= 400 && s < 500) return blocked("FACTORY_ANTHROPIC_REQUEST_REJECTED");
      }
      return { status: "unknown", reason: "FACTORY_ANTHROPIC_EXECUTION_UNCONFIRMED", costCents: 0 };
    } finally { clearTimeout(timer); input.signal.removeEventListener("abort", abort); }
  };
}
