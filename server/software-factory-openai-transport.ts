/** Private operator credential stays in the control process. This transport
 * does not admit spending: callers must reserve in the shared ledger first. */
export function createFactoryOpenAiTransport(key: string, transport: typeof fetch = fetch) {
  if (!/^sk-[A-Za-z0-9_-]{20,300}$/.test(key)) throw Error("FACTORY_OPENAI_CREDENTIAL_REQUIRED");
  return async (url: string, init: RequestInit): Promise<Response> => {
    let target: URL;
    try { target = new URL(url); } catch { throw Error("FACTORY_OPENAI_TRANSPORT_SCOPE_INVALID"); }
    if (target.origin !== "https://api.openai.com" || target.username || target.password || target.search || target.hash ||
        !["/v1/responses", "/v1/responses/input_tokens"].includes(target.pathname) || init.method !== "POST" ||
        !init.signal || typeof init.body !== "string" || !init.body || Buffer.byteLength(init.body) > 1048576) {
      throw Error("FACTORY_OPENAI_TRANSPORT_SCOPE_INVALID");
    }
    init.signal.throwIfAborted();
    // Caller headers cannot redirect billing to another project/organization or
    // attach cookies. Neither redirects nor hidden SDK retries are permitted.
    try {
      return await transport(target.href, {
        method: "POST", body: init.body, signal: init.signal, redirect: "error", credentials: "omit",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      });
    } catch { throw Error("FACTORY_OPENAI_TRANSPORT_UNCONFIRMED"); }
  };
}
