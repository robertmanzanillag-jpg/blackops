import { currentFactoryApiParent } from "./factory-api-context";

const COUNT_URL = "https://api.openai.com/v1/responses/input_tokens";
const COUNT_FIELDS = new Set(["model", "instructions", "input", "reasoning", "text"]);
/** The reviewed Factory monetary gate (factory-api-sdk.ts, pinned by the
 * office-api-budget-v6 package) only admits priced /v1/responses creates, so
 * the provider's mandatory pre-call token count was always refused and OpenAI
 * factory calls could never run. Input-token counting generates no output and
 * is not billed, so it needs no monetary hold. This narrow transport serves
 * ONLY that endpoint: inside a claimed Factory job, prompt fields only (never
 * generation fields, tools, storage or streaming), no redirects or cookies. */
export function createFactoryOpenAiCountTransport(key: string, transport: typeof fetch = fetch) {
  if (!/^sk-[A-Za-z0-9_-]{20,300}$/.test(key)) throw Error("FACTORY_OPENAI_CREDENTIAL_REQUIRED");
  return async (url: string, init: RequestInit): Promise<Response> => {
    if (url !== COUNT_URL || init.method !== "POST" || !init.signal || typeof init.body !== "string" || !init.body || Buffer.byteLength(init.body) > 1048576) throw Error("FACTORY_OPENAI_COUNT_SCOPE_INVALID");
    if (!currentFactoryApiParent()) throw Error("FACTORY_OPENAI_COUNT_PARENT_CONTEXT_UNAVAILABLE");
    let body: Record<string, unknown>;
    try { body = JSON.parse(init.body); } catch { throw Error("FACTORY_OPENAI_COUNT_SCOPE_INVALID"); }
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.model !== "string" || Object.keys(body).some(k => !COUNT_FIELDS.has(k)) ||
      // Plain text only: structured input items (files, images, URLs) are refused.
      typeof body.input !== "string" || (body.instructions !== undefined && typeof body.instructions !== "string")) throw Error("FACTORY_OPENAI_COUNT_SCOPE_INVALID");
    init.signal.throwIfAborted();
    try {
      return await transport(COUNT_URL, { method: "POST", body: JSON.stringify(body), signal: init.signal, redirect: "error", credentials: "omit",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" } });
    } catch { throw Error("FACTORY_OPENAI_COUNT_TRANSPORT_UNCONFIRMED"); }
  };
}
/** Count calls go to the count transport; everything else to the gated one. */
export function routeFactoryOpenAiRequests(gated: (url: string, init: RequestInit) => Promise<Response>, count: (url: string, init: RequestInit) => Promise<Response>) {
  return (url: string, init: RequestInit) => (url === COUNT_URL ? count(url, init) : gated(url, init));
}
