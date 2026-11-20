import {FactoryApiBudgetError} from "./factory-api-invocation";
import {snapshotFactoryApiRequest,snapshotFactoryApiRequestOptions,guardFactoryOpenAiClient} from "./factory-api-sdk";
import { randomUUID } from "node:crypto";
import { blackopsApplicationName } from "./agent-council-store";

/** Provider order and per-provider ledgers remain secondary constraints. Every
 * production SDK client (including router-disabled/integration fallback) also
 * requires the single reconciled Factory API monetary authority. Provider caps
 * do not add funds or bypass it. Unsupported usage dimensions remain held.
 * Factory API errors never trigger another provider attempt after uncertainty.
 * Model selection is unchanged; no prices are inferred by this authority. */

export type AiTier = "repetitive" | "standard" | "critical";
export type AiProviderId = "openai" | "deepseek" | "integration";
type Env = Readonly<Record<string, string | undefined>>;

export const AI_PROVIDER_BUDGET_LOCK = "blackops_ai_provider_budget_v1";
export const AI_PROVIDER_TIME_ZONE = "America/New_York";
export const DEFAULT_OPENAI_MONTHLY_BUDGET_USD = 200;
export const DEFAULT_DEEPSEEK_MONTHLY_BUDGET_USD = 50;
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

function real(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v || /^(changeme|replace[-_ ]?me|todo|undefined|null|test-key-not-used)$/i.test(v)) return null;
  return v;
}
function nonNegative(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export interface ProviderConfig {
  id: AiProviderId;
  apiKey: string;
  baseURL?: string;
  /** null = not capped by this router (legacy integration only). */
  monthlyCapUsd: number | null;
  model?: string;
  strongModel?: string;
}

export interface AiRouterConfig {
  /** false = no own key configured: callers keep today's behaviour. */
  enabled: boolean;
  openai: ProviderConfig | null;
  deepseek: ProviderConfig | null;
  integration: ProviderConfig | null;
  integrationFallback: boolean;
  deepseekThinking: boolean;
}

export function aiRouterConfig(env: Env = process.env): AiRouterConfig {
  const openaiKey = real(env.OPENAI_API_KEY);
  const deepseekModel = env.DEEPSEEK_MODEL?.trim() || "";
  // No hardcoded DeepSeek model: without DEEPSEEK_MODEL DeepSeek stays unconfigured.
  const deepseekKey = deepseekModel ? real(env.DEEPSEEK_API_KEY) : null;
  const integrationKey = real(env.AI_INTEGRATIONS_OPENAI_API_KEY);
  return {
    // BlackOps: explicit opt-in. Without AI_ROUTER_ENABLED=true every caller keeps today's path.
    enabled: env.AI_ROUTER_ENABLED === "true" && Boolean(openaiKey || deepseekKey),
    openai: openaiKey ? {
      id: "openai", apiKey: openaiKey,
      baseURL: env.OPENAI_BASE_URL?.trim() || undefined,
      monthlyCapUsd: nonNegative(env.AI_OPENAI_MONTHLY_BUDGET_USD, DEFAULT_OPENAI_MONTHLY_BUDGET_USD),
    } : null,
    deepseek: deepseekKey ? {
      id: "deepseek", apiKey: deepseekKey,
      baseURL: env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL,
      monthlyCapUsd: nonNegative(env.AI_DEEPSEEK_MONTHLY_BUDGET_USD, DEFAULT_DEEPSEEK_MONTHLY_BUDGET_USD),
      model: deepseekModel,
      strongModel: env.DEEPSEEK_STRONG_MODEL?.trim() || deepseekModel,
    } : null,
    integration: integrationKey ? {
      id: "integration", apiKey: integrationKey,
      baseURL: env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim() || undefined,
      monthlyCapUsd: null,
    } : null,
    integrationFallback: env.AI_INTEGRATIONS_FALLBACK_ENABLED !== "false",
    deepseekThinking: env.DEEPSEEK_THINKING === "enabled",
  };
}

/**
 * Client settings for code that needs a plain OpenAI client (audio, images):
 * Robert's own key first, Replit AI Integrations only when no own key exists.
 */
export function openAiClientOptions(env: Env = process.env): { apiKey?: string; baseURL?: string; source: "own" | "integration" | "none" } {
  const own = real(env.OPENAI_API_KEY);
  if (own) return { apiKey: own, baseURL: env.OPENAI_BASE_URL?.trim() || undefined, source: "own" };
  const integration = real(env.AI_INTEGRATIONS_OPENAI_API_KEY);
  if (integration) return { apiKey: integration, baseURL: env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim() || undefined, source: "integration" };
  return { source: "none" };
}

/** True when any OpenAI-compatible model access exists (own keys or integration). */
export function aiModelConfigured(env: Env = process.env): boolean {
  const c = aiRouterConfig(env);
  return Boolean(c.openai || c.deepseek || c.integration);
}

/** Provider order for a tier. `openAiOnly` = the request uses features DeepSeek lacks (hosted web search, audio). */
export function planProviders(tier: AiTier, config: AiRouterConfig, options: { openAiOnly?: boolean } = {}): AiProviderId[] {
  const own: AiProviderId[] = tier === "repetitive" ? ["deepseek", "openai"] : ["openai", "deepseek"];
  const plan = own.filter((id) => (id === "openai" ? config.openai : config.deepseek) && !(options.openAiOnly && id === "deepseek"));
  if (config.integration && config.integrationFallback) plan.push("integration");
  return plan;
}

// ─── Pricing (USD per 1M tokens). Unknown models are charged conservatively. ───
const PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5": { input: 1.25, output: 10 },
  // DeepSeek list prices at PEAK rates (off-peak is half): conservative.
  "deepseek-flash": { input: 0.3, output: 1.2 },
  "deepseek-v4-flash": { input: 0.3, output: 1.2 },
  "deepseek-chat": { input: 0.3, output: 1.2 },
  "deepseek-v4-pro": { input: 1.32, output: 3.96 },
  "deepseek": { input: 1.32, output: 3.96 },
};
const UNKNOWN_PRICE = { input: 5, output: 30 };
export const WEB_SEARCH_CALL_USD = 0.025;
const DEFAULT_OUTPUT_TOKENS = 2_000;

export function routerModelPrice(model: string): { input: number; output: number } {
  const m = (model || "").toLowerCase();
  if (PRICES[m]) return PRICES[m];
  let best: string | null = null;
  for (const key of Object.keys(PRICES)) if (m.startsWith(key) && (!best || key.length > best.length)) best = key;
  return best ? PRICES[best] : UNKNOWN_PRICE;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
export function routerCostUsd(model: string, inputTokens: number, outputTokens: number, webSearchCalls = 0): number {
  const p = routerModelPrice(model);
  const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  return round6(safe(inputTokens) / 1e6 * p.input + safe(outputTokens) / 1e6 * p.output + safe(webSearchCalls) * WEB_SEARCH_CALL_USD);
}

function hostedTools(body: Record<string, any>): number {
  return Array.isArray(body.tools) ? body.tools.filter((t: any) => t && t.type && t.type !== "function").length : 0;
}

/** Upper-bound reservation: ~3 chars per input token, the request's own output cap (or 2k), web search x3. */
export function estimateReservationUsd(model: string, body: Record<string, any>): number {
  const { tools: _tools, ...rest } = body ?? {};
  let chars = 0;
  try { chars = JSON.stringify(rest).length + (Array.isArray(body?.tools) ? JSON.stringify(body.tools).length : 0); } catch { chars = 200_000; }
  const inputTokens = Math.ceil(chars / 3) + 50;
  const output = Number(body?.max_output_tokens ?? body?.max_completion_tokens ?? body?.max_tokens) || DEFAULT_OUTPUT_TOKENS;
  const searches = hostedTools(body) > 0 ? 3 : 0;
  return Math.max(0.0001, routerCostUsd(model, inputTokens, output, searches));
}

// ─── Ledger ────────────────────────────────────────────────────────────────
export interface ProviderReservation { id: string; provider: AiProviderId; reservedUsd: number }
export interface AiProviderLedger {
  reserve(input: { provider: AiProviderId; tier: AiTier; label: string; model: string; amountUsd: number; monthlyCapUsd: number }): Promise<ProviderReservation | null>;
  /** costUsd null = unknown outcome: the full reservation stays charged. */
  settle(reservation: ProviderReservation, outcome: { ok: boolean; costUsd: number | null; inputTokens?: number; outputTokens?: number; model?: string }): Promise<void>;
  monthToDate(provider: AiProviderId): Promise<number>;
}

interface SqlPool {
  connect(): Promise<{ query(sql: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>; release(): void }>;
  query(sql: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export const AI_PROVIDER_LEDGER_SQL = `CREATE TABLE IF NOT EXISTS blackops_ai_provider_ledger (
  id text PRIMARY KEY,
  provider text NOT NULL,
  tier text NOT NULL,
  label text,
  model text,
  status text NOT NULL DEFAULT 'reserved',
  reserved_usd numeric(12,6) NOT NULL,
  cost_usd numeric(12,6) NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS blackops_ai_provider_ledger_month_idx ON blackops_ai_provider_ledger(provider, created_at);`;

const MONTH_START = `(date_trunc('month', $2::timestamptz AT TIME ZONE '${AI_PROVIDER_TIME_ZONE}') AT TIME ZONE '${AI_PROVIDER_TIME_ZONE}')`;

export class PostgresAiProviderLedger implements AiProviderLedger {
  private ensured: Promise<void> | null = null;
  constructor(private readonly pool: SqlPool, private readonly clock: () => Date = () => new Date()) {}
  private ensure(): Promise<void> {
    if (!this.ensured) this.ensured = this.pool.query(AI_PROVIDER_LEDGER_SQL).then(() => undefined, (e) => { this.ensured = null; throw e; });
    return this.ensured;
  }
  async reserve(input: Parameters<AiProviderLedger["reserve"]>[0]): Promise<ProviderReservation | null> {
    if (!(input.monthlyCapUsd > 0) || !(input.amountUsd > 0)) return null;
    await this.ensure();
    const now = this.clock();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [AI_PROVIDER_BUDGET_LOCK]);
      const spent = await client.query(`SELECT COALESCE(SUM(cost_usd),0) AS spent FROM blackops_ai_provider_ledger WHERE provider = $1 AND created_at >= ${MONTH_START}`, [input.provider, now]);
      const used = Number(spent.rows[0]?.spent ?? 0);
      if (!Number.isFinite(used) || used + input.amountUsd > input.monthlyCapUsd) { await client.query("ROLLBACK"); return null; }
      const id = randomUUID();
      await client.query(`INSERT INTO blackops_ai_provider_ledger(id,provider,tier,label,model,status,reserved_usd,cost_usd,created_at)
        VALUES($1,$2,$3,$4,$5,'reserved',$6,$6,$7)`, [id, input.provider, input.tier, input.label.slice(0, 120), input.model.slice(0, 120), round6(input.amountUsd), now]);
      await client.query("COMMIT");
      return { id, provider: input.provider, reservedUsd: round6(input.amountUsd) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
  async settle(reservation: ProviderReservation, outcome: Parameters<AiProviderLedger["settle"]>[1]): Promise<void> {
    const cost = outcome.costUsd === null || !Number.isFinite(outcome.costUsd) || outcome.costUsd < 0 ? reservation.reservedUsd : round6(outcome.costUsd);
    await this.pool.query(`UPDATE blackops_ai_provider_ledger SET status=$2, cost_usd=$3, input_tokens=$4, output_tokens=$5, model=COALESCE($6, model), settled_at=$7
      WHERE id=$1 AND status='reserved'`, [reservation.id, outcome.ok ? "settled" : "failed", cost,
      Math.max(0, Math.floor(outcome.inputTokens ?? 0)), Math.max(0, Math.floor(outcome.outputTokens ?? 0)), outcome.model ?? null, this.clock()]);
  }
  async monthToDate(provider: AiProviderId): Promise<number> {
    await this.ensure();
    const r = await this.pool.query(`SELECT COALESCE(SUM(cost_usd),0) AS spent FROM blackops_ai_provider_ledger WHERE provider = $1 AND created_at >= ${MONTH_START}`, [provider, this.clock()]);
    return Number(r.rows[0]?.spent ?? 0) || 0;
  }
}

/**
 * In-process ledger for tests: same reserve/settle semantics (single month). Reservations are
 * serialized through a promise chain, like the advisory lock in Postgres, so concurrent
 * reserve() calls cannot overshoot the cap. `readDelayMs` widens the read-then-write window.
 */
export class InMemoryAiProviderLedger implements AiProviderLedger {
  readonly rows: Array<{ id: string; provider: AiProviderId; tier: AiTier; label: string; model: string; status: string; reservedUsd: number; costUsd: number }> = [];
  private lock: Promise<unknown> = Promise.resolve();
  constructor(private readonly readDelayMs = 0) {}
  reserve(input: Parameters<AiProviderLedger["reserve"]>[0]): Promise<ProviderReservation | null> {
    const run = this.lock.then(async () => {
      if (!(input.monthlyCapUsd > 0) || !(input.amountUsd > 0)) return null;
      const spent = await this.monthToDate(input.provider);
      if (this.readDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.readDelayMs));
      if (spent + input.amountUsd > input.monthlyCapUsd) return null;
      const id = randomUUID();
      this.rows.push({ id, provider: input.provider, tier: input.tier, label: input.label, model: input.model, status: "reserved", reservedUsd: input.amountUsd, costUsd: input.amountUsd });
      return { id, provider: input.provider, reservedUsd: input.amountUsd };
    });
    this.lock = run.catch(() => undefined);
    return run;
  }
  async settle(reservation: ProviderReservation, outcome: Parameters<AiProviderLedger["settle"]>[1]) {
    const row = this.rows.find((r) => r.id === reservation.id && r.status === "reserved");
    if (!row) return;
    row.status = outcome.ok ? "settled" : "failed";
    row.costUsd = outcome.costUsd === null || !Number.isFinite(outcome.costUsd) || outcome.costUsd < 0 ? reservation.reservedUsd : outcome.costUsd;
    if (outcome.model) row.model = outcome.model;
  }
  async monthToDate(provider: AiProviderId) { return round6(this.rows.filter((r) => r.provider === provider).reduce((s, r) => s + r.costUsd, 0)); }
}

let defaultLedger: Promise<AiProviderLedger> | null = null;
function getDefaultLedger(): Promise<AiProviderLedger> {
  if (!defaultLedger) {
    defaultLedger = Promise.all([import("pg"), import("./database-url")]).then(([pg, { resolveDatabaseConnectionString }]) => {
      const Pool = (pg as any).Pool ?? (pg as any).default?.Pool;
      return new PostgresAiProviderLedger(new Pool({ connectionString: resolveDatabaseConnectionString(), max: 2, allowExitOnIdle: true, application_name: blackopsApplicationName("ai-ledger") }) as unknown as SqlPool);
    });
    defaultLedger.catch(() => { defaultLedger = null; });
  }
  return defaultLedger;
}

// ─── Request adapters ────────────────────────────────────────────────────────
const OPENAI_ONLY_CHAT_PARAMS = ["store", "safety_identifier", "reasoning_effort", "service_tier", "prompt_cache_key", "verbosity", "metadata", "modalities", "audio", "prediction", "web_search_options", "parallel_tool_calls"];

function schemaHint(format: any): string | null {
  if (!format || format.type !== "json_schema") return null;
  const schema = format.json_schema?.schema ?? format.schema;
  if (!schema) return "Respond only with a valid json object.";
  let encoded = "";
  try { encoded = JSON.stringify(schema).slice(0, 8_000); } catch { encoded = ""; }
  return `Respond only with a valid json object that matches this JSON schema exactly (all required keys, no extra keys): ${encoded}`;
}

/** OpenAI chat.completions body -> DeepSeek chat.completions body. */
export function toDeepSeekChatBody(body: Record<string, any>, model: string, thinking: boolean): Record<string, any> {
  const out: Record<string, any> = { ...body, model };
  for (const key of OPENAI_ONLY_CHAT_PARAMS) delete out[key];
  if (out.max_completion_tokens !== undefined) {
    if (out.max_tokens === undefined) out.max_tokens = out.max_completion_tokens;
    delete out.max_completion_tokens;
  }
  if (!thinking) out.thinking = { type: "disabled" };
  const rf = out.response_format;
  const messages = Array.isArray(out.messages) ? [...out.messages] : [];
  if (rf && (rf.type === "json_schema" || rf.type === "json_object")) {
    const hint = schemaHint(rf) ?? "Respond only with a valid json object.";
    out.response_format = { type: "json_object" };
    messages.unshift({ role: "system", content: hint });
  }
  out.messages = messages;
  return out;
}

function responsesContentToChat(content: any): any {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  const parts = content.map((part: any) => {
    if (part?.type === "input_text" || part?.type === "output_text" || part?.type === "text") return { type: "text", text: String(part.text ?? "") };
    if (part?.type === "input_image") return { type: "image_url", image_url: { url: part.image_url ?? part.url } };
    return { type: "text", text: typeof part === "string" ? part : JSON.stringify(part) };
  });
  return parts.every((p: any) => p.type === "text") ? parts.map((p: any) => p.text).join("\n") : parts;
}

/** OpenAI responses.create body (no hosted tools) -> DeepSeek chat body. */
export function responsesToDeepSeekChatBody(body: Record<string, any>, model: string, thinking: boolean): Record<string, any> {
  const messages: any[] = [];
  if (typeof body.instructions === "string" && body.instructions.trim()) messages.push({ role: "system", content: body.instructions });
  if (typeof body.input === "string") messages.push({ role: "user", content: body.input });
  else if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (!item || typeof item !== "object") continue;
      const role = item.role === "assistant" || item.role === "system" || item.role === "developer" ? (item.role === "developer" ? "system" : item.role) : "user";
      messages.push({ role, content: responsesContentToChat(item.content) });
    }
  }
  const format = body.text?.format;
  const chat: Record<string, any> = { model, messages };
  if (format?.type === "json_schema" || format?.type === "json_object") chat.response_format = format.type === "json_schema" ? { type: "json_schema", json_schema: { schema: format.schema } } : { type: "json_object" };
  if (body.max_output_tokens !== undefined) chat.max_tokens = body.max_output_tokens;
  if (body.temperature !== undefined) chat.temperature = body.temperature;
  if (Array.isArray(body.tools) && body.tools.length) {
    chat.tools = body.tools.filter((t: any) => t?.type === "function").map((t: any) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  }
  return toDeepSeekChatBody(chat, model, thinking);
}

/** DeepSeek chat completion -> minimal OpenAI Responses-shaped object (what KONG callers read). */
export function chatCompletionToResponse(completion: any, model: string): Record<string, any> {
  const choice = completion?.choices?.[0];
  const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
  const inputTokens = Number(completion?.usage?.prompt_tokens ?? 0);
  const outputTokens = Number(completion?.usage?.completion_tokens ?? 0);
  const incomplete = choice?.finish_reason === "length";
  return {
    id: `deepseek_${completion?.id ?? randomUUID()}`,
    object: "response",
    model: completion?.model ?? model,
    status: incomplete ? "incomplete" : "completed",
    ...(incomplete ? { incomplete_details: { reason: "max_output_tokens" } } : {}),
    output_text: text,
    output: [{ type: "message", role: "assistant", status: incomplete ? "incomplete" : "completed", content: [{ type: "output_text", text, annotations: [] }] }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
  };
}

// ─── Routed client ───────────────────────────────────────────────────────────
export interface ChatLikeClient {
  chat: { completions: { create(body: any, options?: any): Promise<any> } };
  responses?: { create(body: any, options?: any): Promise<any> };
  audio?: { transcriptions: { create(body: any, options?: any): Promise<any> } };
}

export class AiBudgetUnavailableError extends Error {
  readonly code = "ai_provider_budget_unavailable";
  constructor(readonly tier: AiTier) { super(`AI provider budget unavailable for tier ${tier}`); this.name = "AiBudgetUnavailableError"; }
}
export function isAiBudgetUnavailable(error: unknown): boolean {
  return error instanceof AiBudgetUnavailableError || (error as { code?: string } | null)?.code === "ai_provider_budget_unavailable";
}
export class AiNoProviderError extends Error {
  readonly code = "ai_provider_unconfigured";
  constructor() { super("No AI provider configured"); this.name = "AiNoProviderError"; }
}

export interface RoutedClientOptions {
  /** Fixed tier, or a function of the request body (e.g. owner chat vs scheduled brief). */
  tier: AiTier | ((body: Record<string, any>) => AiTier);
  label: string;
  env?: Env;
  ledger?: AiProviderLedger;
  /** Builds an OpenAI-compatible client for a provider (default: openai SDK). */
  makeClient?: (provider: ProviderConfig) => ChatLikeClient | Promise<ChatLikeClient>;
  /** Today's client, used verbatim when no own key is configured. */
  legacy?: () => ChatLikeClient | Promise<ChatLikeClient>;
  factoryInvocation?: ReturnType<typeof import("./factory-api-invocation").createFactoryApiInvocation>;
  factoryPricing?: (provider:AiProviderId,model:string)=>import("./factory-api-invocation").FactoryApiPrice;
  onRoute?: (event: { provider: AiProviderId; model: string; outcome: "ok" | "error" | "budget" | "ledger_error"; costUsd?: number }) => void;
}

const clientCache = new Map<string, Promise<ChatLikeClient>>();
async function defaultMakeClient(provider: ProviderConfig): Promise<ChatLikeClient> {
  const key = `${provider.id}|${provider.baseURL ?? ""}|${provider.apiKey.slice(-6)}`;
  if (!clientCache.has(key)) {
    clientCache.set(key, import("openai").then(({ default: OpenAI }) => new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL, maxRetries:0 }) as unknown as ChatLikeClient));
  }
  return clientCache.get(key)!;
}

function isAbort(error: any): boolean {
  return error?.name === "AbortError" || error?.name === "APIUserAbortError" || error?.name === "TimeoutError";
}
/** 4xx (except 408/409/429) means the provider rejected the request before billing it. */
function rejectedBeforeBilling(error: any): boolean {
  const status = Number(error?.status ?? error?.response?.status);
  return Number.isFinite(status) && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
}

type CallKind = "chat" | "responses" | "transcription";

export function createRoutedOpenAI(options: RoutedClientOptions): ChatLikeClient & { readonly routed: boolean } {
  const env = options.env ?? process.env;
  const makeClient = options.makeClient ?? defaultMakeClient;

  async function legacyClient(): Promise<ChatLikeClient> {
    if (options.legacy) return options.legacy();
    const c = aiRouterConfig(env);
    if (!c.integration) throw new AiNoProviderError();
    return makeClient(c.integration);
  }

  async function run(kind: CallKind, body: Record<string, any>, requestOptions?: any): Promise<any> {
    body=snapshotFactoryApiRequest(kind==="chat"?"chat.completions.create":kind==="responses"?"responses.create":"audio.transcriptions.create",body).body;
    requestOptions=snapshotFactoryApiRequestOptions(requestOptions);
    const config = aiRouterConfig(env);
    if (!config.enabled) {
      const legacy = guardFactoryOpenAiClient(await legacyClient(),{provider:config.integration?"integration":"openai",env,invoke:options.factoryInvocation,price:options.factoryPricing?(model)=>options.factoryPricing!(config.integration?"integration":"openai",model):undefined});
      if (kind === "chat") return legacy.chat.completions.create(body, requestOptions);
      if (kind === "responses") return legacy.responses!.create(body, requestOptions);
      return legacy.audio!.transcriptions.create(body, requestOptions);
    }
    const tier: AiTier = typeof options.tier === "function" ? options.tier(body ?? {}) : options.tier;
    // Streams are allowed on both providers; their usage arrives in the stream, so they settle at the reservation (upper bound).
    const openAiOnly = kind === "transcription" || (kind === "responses" && hostedTools(body) > 0);
    const plan = planProviders(tier, config, { openAiOnly });
    const ledger = options.ledger ?? await getDefaultLedger();
    let budgetBlocked = false;
    let ledgerFailed = false;
    let lastError: unknown = null;
    for (const providerId of plan) {
      // Fail closed: a reached cap or an unreadable ledger never spills to uncapped Replit integrations.
      if (providerId === "integration" && (budgetBlocked || ledgerFailed)) break;
      const provider = (providerId === "openai" ? config.openai : providerId === "deepseek" ? config.deepseek : config.integration)!;
      const model = providerId === "deepseek"
        ? (tier === "critical" ? provider.strongModel! : provider.model!)
        : String(body?.model ?? "");
      let reservation: ProviderReservation | null = null;
      if (provider.monthlyCapUsd !== null) {
        const amountUsd = kind === "transcription"
          ? nonNegative(env.AI_ROUTER_AUDIO_RESERVATION_USD, 0.05) || 0.05
          : estimateReservationUsd(model, body);
        try {
          reservation = await ledger.reserve({ provider: providerId, tier, label: options.label, model, amountUsd, monthlyCapUsd: provider.monthlyCapUsd });
        } catch {
          options.onRoute?.({ provider: providerId, model, outcome: "ledger_error" });
          ledgerFailed = true;
          continue; // never call an own-key provider without a reservation
        }
        if (!reservation) { budgetBlocked = true; options.onRoute?.({ provider: providerId, model, outcome: "budget" }); continue; }
      }
      try {
        const client = guardFactoryOpenAiClient(await makeClient(provider),{provider:providerId,env,invoke:options.factoryInvocation,price:options.factoryPricing?(model)=>options.factoryPricing!(providerId,model):undefined});
        let result: any;
        let usage = { input: 0, output: 0, searches: 0 };
        if (kind === "chat") {
          const payload = providerId === "deepseek" ? toDeepSeekChatBody(body, model, config.deepseekThinking) : body;
          result = await client.chat.completions.create(payload, requestOptions);
          usage = { input: Number(result?.usage?.prompt_tokens ?? 0), output: Number(result?.usage?.completion_tokens ?? 0), searches: 0 };
        } else if (kind === "responses") {
          if (providerId === "deepseek") {
            const completion = await client.chat.completions.create(responsesToDeepSeekChatBody(body, model, config.deepseekThinking), requestOptions);
            result = chatCompletionToResponse(completion, model);
          } else {
            result = await client.responses!.create(body, requestOptions);
          }
          const searches = Array.isArray(result?.output) ? result.output.filter((o: any) => o?.type === "web_search_call").length : 0;
          usage = { input: Number(result?.usage?.input_tokens ?? 0), output: Number(result?.usage?.output_tokens ?? 0), searches };
        } else {
          result = await client.audio!.transcriptions.create(body, requestOptions);
        }
        const usedModel = String(result?.model ?? model);
        const hasUsage = usage.input > 0 || usage.output > 0;
        const costUsd = hasUsage ? routerCostUsd(usedModel, usage.input, usage.output, usage.searches) : null;
        if (reservation) await ledger.settle(reservation, { ok: true, costUsd, inputTokens: usage.input, outputTokens: usage.output, model: usedModel }).catch(() => undefined);
        options.onRoute?.({ provider: providerId, model: usedModel, outcome: "ok", costUsd: costUsd ?? reservation?.reservedUsd });
        return result;
      } catch (error) {
        if (reservation) {
          // Rejected before billing -> release; otherwise the outcome is unknown and stays charged.
          await ledger.settle(reservation, { ok: false, costUsd: error instanceof FactoryApiBudgetError&&!error.dispatched ? 0 : rejectedBeforeBilling(error) ? 0 : null }).catch(() => undefined);
        }
        options.onRoute?.({ provider: providerId, model, outcome: "error" });
        if (error instanceof FactoryApiBudgetError || isAbort(error)) throw error;
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    throw budgetBlocked || ledgerFailed ? new AiBudgetUnavailableError(tier) : new AiNoProviderError();
  }

  return {
    get routed() { return aiRouterConfig(env).enabled; },
    chat: { completions: { create: (body: any, requestOptions?: any) => run("chat", body, requestOptions) } },
    responses: { create: (body: any, requestOptions?: any) => run("responses", body, requestOptions) },
    audio: { transcriptions: { create: (body: any, requestOptions?: any) => run("transcription", body, requestOptions) } },
  };
}

/** Month-to-date spend per own provider, for admin views. */
export async function aiProviderSpendSummary(env: Env = process.env, ledger?: AiProviderLedger) {
  const config = aiRouterConfig(env);
  const l = ledger ?? await getDefaultLedger();
  const row = async (p: ProviderConfig | null) => p ? { configured: true, capUsd: p.monthlyCapUsd ?? 0, spentUsd: round6(await l.monthToDate(p.id).catch(() => 0)) } : { configured: false, capUsd: 0, spentUsd: 0 };
  return { enabled: config.enabled, openai: await row(config.openai), deepseek: await row(config.deepseek), integrationFallback: Boolean(config.integration && config.integrationFallback) };
}

/**
 * Routed client for call sites that used `new OpenAI({ apiKey: AI_INTEGRATIONS_OPENAI_API_KEY
 * (|| OPENAI_API_KEY), baseURL: AI_INTEGRATIONS_OPENAI_BASE_URL })`. Without own keys the
 * legacy client is exactly that previous client (created lazily on first use).
 */
export function routedOpenAI(tier: RoutedClientOptions["tier"], label: string, env: Env = process.env): ChatLikeClient & { readonly routed: boolean } {
  let legacyClient: Promise<ChatLikeClient> | null = null;
  return createRoutedOpenAI({
    tier, label, env,
    legacy: () => {
      if(!legacyClient){
        const config=aiRouterConfig(env),provider=config.integration??config.openai;
        if(!provider)throw new AiNoProviderError();
        legacyClient=import("openai").then(({default:OpenAI})=>new OpenAI({apiKey:provider.apiKey,baseURL:provider.baseURL,maxRetries:0}) as unknown as ChatLikeClient);
      }
      return legacyClient;
    },
  });
}

/** Same as routedOpenAI, but null when no model access is configured at all. */
export function routedClientFromEnv(tier: RoutedClientOptions["tier"], label: string, env: Env = process.env): ChatLikeClient | null {
  return aiModelConfigured(env) ? routedOpenAI(tier, label, env) : null;
}

/** Plain text completion through the router (system + user prompt). */
export async function routedText(input: {
  tier: AiTier; label: string; prompt: string; system?: string; model?: string; maxTokens?: number;
  json?: boolean; env?: Env; ledger?: AiProviderLedger; factoryInvocation?:RoutedClientOptions["factoryInvocation"];factoryPricing?:RoutedClientOptions["factoryPricing"]; makeClient?: RoutedClientOptions["makeClient"]; legacy?: RoutedClientOptions["legacy"];
}): Promise<{ text: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; provider: AiProviderId | "legacy" }> {
  let provider: AiProviderId | "legacy" = "legacy";
  let costUsd = 0;
  const client = createRoutedOpenAI({
    tier: input.tier, label: input.label, env: input.env, ledger: input.ledger,factoryInvocation:input.factoryInvocation,factoryPricing:input.factoryPricing, makeClient: input.makeClient, legacy: input.legacy,
    onRoute: (e) => { if (e.outcome === "ok") { provider = e.provider; costUsd = e.costUsd ?? 0; } },
  });
  const env = input.env ?? process.env;
  const model = input.model || env.OPENAI_ASSISTANT_MODEL || "gpt-5.4-nano";
  const completion = await client.chat.completions.create({
    model,
    messages: [...(input.system ? [{ role: "system", content: input.system }] : []), { role: "user", content: input.prompt }],
    max_completion_tokens: input.maxTokens ?? 900,
    ...(input.json ? { response_format: { type: "json_object" } } : {}),
  });
  const text = typeof completion?.choices?.[0]?.message?.content === "string" ? completion.choices[0].message.content : "";
  return {
    text, provider, costUsd,
    model: String(completion?.model ?? model),
    inputTokens: Number(completion?.usage?.prompt_tokens ?? 0),
    outputTokens: Number(completion?.usage?.completion_tokens ?? 0),
  };
}

/** True when AI_ROUTER_ENABLED=true and DeepSeek (key + model) is configured for cheap work. */
export function deepSeekRouted(env: Env = process.env): boolean {
  const c = aiRouterConfig(env);
  return c.enabled && Boolean(c.deepseek);
}
