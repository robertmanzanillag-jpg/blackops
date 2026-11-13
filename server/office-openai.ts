import type { OfficeClaudeProbe } from "./office-claude";

export type OfficeOpenAIUsage = { inputTokens: number; outputTokens: number; totalTokens: number };
export type OfficeOpenAIResult = {
  text: string; sessionId: string; completedAt: string; provider: "openai";
  model: string; usage: OfficeOpenAIUsage;
};
export class OfficeOpenAIError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "OfficeOpenAIError"; }
}

// Budget admission must be durable and precede the request. An uncertain call
// keeps its reservation: this adapter never retries a potentially billed request.
export function createOfficeOpenAI(options: {
  env?: NodeJS.ProcessEnv; fetch?: typeof fetch; now?: () => Date;
  authorize?: (limits: { model: string; promptBytes: number; maxOutputTokens: number }) => Promise<void>;
  recordUsage?: (result: Omit<OfficeOpenAIResult, "text">) => Promise<void>;
} = {}) {
  const transport = options.fetch || fetch;
  const now = options.now || (() => new Date());
  const config = () => {
    const env = options.env || process.env;
    if (env.OFFICE_REVIEW_PROVIDER !== "openai") throw new OfficeOpenAIError("disabled", "El proveedor OpenAI no esta habilitado para esta oficina.");
    const key = env.OPENAI_API_KEY?.trim();
    const model = env.OFFICE_OPENAI_MODEL?.trim();
    const maxOutputTokens = Number(env.OFFICE_OPENAI_MAX_OUTPUT_TOKENS || "2048");
    if (!key || /\s/.test(key)) throw new OfficeOpenAIError("missing_key", "Falta la conexion autorizada de OpenAI.");
    if (!model || !/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new OfficeOpenAIError("missing_model", "Falta un modelo autorizado para el ejecutor.");
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 32 || maxOutputTokens > 4096) throw new OfficeOpenAIError("invalid_limit", "El limite de salida no es valido.");
    if (!options.authorize || !options.recordUsage) throw new OfficeOpenAIError("budget_unavailable", "Falta la reserva persistente de presupuesto y consumo.");
    return { key, model, maxOutputTokens };
  };
  const probeOfficeOpenAI = async (): Promise<OfficeClaudeProbe> => {
    try { config(); return { status: "ready", checkedAt: now().toISOString(), reason: "OpenAI configurado; solo una ejecucion completada acredita funcionamiento." }; }
    catch (e) { return { status: "blocked", checkedAt: now().toISOString(), reason: e instanceof OfficeOpenAIError ? e.message : "No se pudo comprobar OpenAI." }; }
  };
  const runOfficeOpenAI = async (prompt: string): Promise<OfficeOpenAIResult> => {
    const promptBytes = typeof prompt === "string" ? Buffer.byteLength(prompt) : 0;
    if (!promptBytes || !prompt.trim() || promptBytes > 65536) throw new OfficeOpenAIError("invalid_prompt", "El mensaje debe contener texto y no superar 64 KiB.");
    const { key, model, maxOutputTokens } = config();
    await options.authorize!({ model, promptBytes, maxOutputTokens });
    let response: Response;
    let body: any;
    try {
      response = await transport("https://api.openai.com/v1/responses", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(120000),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: prompt, max_output_tokens: maxOutputTokens, service_tier: "default", store: false, tools: [] }),
      });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("missing body");
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.length;
        if (size > 1048576) { await reader.cancel(); throw new Error("oversized body"); }
        chunks.push(part.value);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { throw new OfficeOpenAIError("execution_unknown", "No se pudo confirmar el resultado de OpenAI; requiere conciliacion antes de reintentar."); }
    if (!response.ok) {
      const code = response.status === 401 ? "authentication_failed" : response.status === 429 ? "quota_or_rate_limit" : response.status >= 500 ? "provider_error" : "request_rejected";
      throw new OfficeOpenAIError(code, "OpenAI rechazo la ejecucion; no se reintentara automaticamente.");
    }
    const raw = body?.usage;
    const usage = { inputTokens: raw?.input_tokens, outputTokens: raw?.output_tokens, totalTokens: raw?.total_tokens };
    if (typeof body?.id !== "string" || !body.id.startsWith("resp_") || typeof body.model !== "string" || !body.model.trim() ||
      !Object.values(usage).every(v => Number.isSafeInteger(v) && v >= 0) || usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
      throw new OfficeOpenAIError("invalid_usage", "OpenAI no devolvio una identificacion y consumo verificables.");
    }
    const metadata = { sessionId: body.id, completedAt: now().toISOString(), provider: "openai" as const, model: body.model as string, usage };
    if (!["completed", "failed", "incomplete", "cancelled"].includes(body.status)) {
      throw new OfficeOpenAIError("execution_unknown", "La ejecucion puede seguir activa; su reserva debe conservarse.");
    }
    try { await options.recordUsage!(metadata); }
    catch { throw new OfficeOpenAIError("execution_unknown", "El consumo de OpenAI no pudo confirmarse en el registro persistente; requiere conciliacion."); }
    const messages = Array.isArray(body.output) ? body.output.filter((item: any) => item.type === "message" && item.role === "assistant") : [];
    const parts = messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).filter((part: any) => part.type === "output_text");
    if (parts.some((part: any) => typeof part.text !== "string")) throw new OfficeOpenAIError("invalid_output", "OpenAI no devolvio texto verificable.");
    const text = parts.map((part: any) => part.text).join("\n");
    if (body.status !== "completed" || body.error || messages.some((m: any) => m.status !== "completed") || typeof text !== "string" || !text.trim()) {
      throw new OfficeOpenAIError("incomplete_result", "La respuesta no esta completada; no sirve como evidencia de trabajo correcto.");
    }
    return { ...metadata, text };
  };
  return { runOfficeOpenAI, probeOfficeOpenAI };
}
