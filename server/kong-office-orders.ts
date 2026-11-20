// Owner orders from the office agent chat to KONG desks and city agents.
//
// KONG exposes POST /api/admin/ceo/office-orders (body {agentId, text, idempotencyKey}, returns
// {taskId, status, agent}) and GET /api/admin/ceo/office-orders/:id for the task status. The office
// only forwards what Robert typed; KONG runs (or refuses) the work and reports back.
//
// Security: the token (KONG_OFFICE_ORDER_TOKEN, a dedicated secret) is only sent in the
// Authorization header to the configured HTTPS URL, never logged, never returned, and redacted from
// anything KONG sends back. Errors never carry fetch errors, headers or bodies.

import { createHash } from "node:crypto";
import { KONG_DESK_PROFILE, KONG_ORDER_MAX_TEXT, isKongOrderAgentShape } from "@shared/agent-chat-routing";
export { KONG_DESK_PROFILE, KONG_ORDER_MAX_TEXT, isKongOrderAgentShape };

export const DEFAULT_KONG_OFFICE_ORDER_URL = "https://kongnightlife.com/api/admin/ceo/office-orders";
const TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 64 * 1024;
const TASK_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type KongOfficeOrderErrorCode =
  | "RATE_LIMITED" | "DISABLED" | "NOT_CONFIGURED" | "INVALID_CONFIGURATION" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "REJECTED"
  | "UNAVAILABLE" | "INVALID_RESPONSE" | "TIMEOUT" | "CONNECTION_FAILED";
export class KongOfficeOrderError extends Error {
  constructor(public readonly code: KongOfficeOrderErrorCode, message: string) { super(message); this.name = "KongOfficeOrderError"; }
}
const fail = (code: KongOfficeOrderErrorCode, message: string): never => { throw new KongOfficeOrderError(code, message); };

export type KongOfficeOrderTask = { taskId: string; status: string; agent: string | null; result: string | null };
export type KongOfficeOrderClient = {
  /** True when the dedicated order token is configured (the URL has a safe default). */
  enabled(): boolean;
  send(input: { agentId: string; text: string; idempotencyKey: string }): Promise<KongOfficeOrderTask>;
  status(taskId: string): Promise<KongOfficeOrderTask>;
};

/**
 * KONG agent id for an office chat id, or null when KONG does not take orders for it:
 * `kong:<desk>` (KONG central desks) and `kong-city:<city>[:<category>]` (pure; tested).
 */
export function kongOrderAgentId(id: string): string | null {
  const mapped = KONG_DESK_PROFILE[id] ?? id;
  return isKongOrderAgentShape(mapped) ? mapped : null;
}

/** Stable per message: a retried send reaches KONG with the same key and never creates two tasks. */
export function kongOrderIdempotencyKey(agentId: string, requestId: string): string {
  return `office-${createHash("sha256").update(`${agentId}\n${requestId}`).digest("hex").slice(0, 40)}`;
}

/** The order may have reached KONG: never store a final reply, a retry must reuse the same idempotency key. */
export const isUncertainKongError = (error: unknown) => error instanceof KongOfficeOrderError && ["TIMEOUT", "CONNECTION_FAILED", "UNAVAILABLE"].includes(error.code);
// KONG "ready" = queued or a retry is scheduled (report-tasks.ts), so it is NOT final: keep polling it.
const TERMINAL = new Set(["blocked", "done", "completed", "complete", "succeeded", "success", "failed", "error", "cancelled", "canceled", "rejected", "expired"]);
export const isTerminalKongStatus = (status: string) => TERMINAL.has(status.toLowerCase());
const STATUS_LABELS: Record<string, string> = {
  queued: "en cola", pending: "en cola", accepted: "aceptada", received: "recibida", running: "en curso", ready: "en cola", blocked: "necesita a Robert", in_progress: "en curso", processing: "en curso",
  done: "completada", completed: "completada", complete: "completada", succeeded: "completada", success: "completada",
  failed: "falló", error: "falló", cancelled: "cancelada", canceled: "cancelada", rejected: "rechazada", expired: "caducada",
};
export const kongStatusLabel = (status: string) => STATUS_LABELS[status.toLowerCase()] || status;

/** Where orders go: KONG_OFFICE_ORDER_URL when it is a valid HTTPS URL without credentials, else the default KONG base. */
export function kongOrderUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.KONG_OFFICE_ORDER_URL?.trim();
  if (!raw) return DEFAULT_KONG_OFFICE_ORDER_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/+$/, "");
  } catch { return null; }
}

function redact(value: string, token: string): string {
  return value.split(token).join("[redacted]").replace(/\bBearer\s+[^\s]+/gi, "Bearer [redacted]");
}
const cleanText = (value: unknown, max: number, token: string) =>
  typeof value === "string" && value.trim() ? redact(value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim(), token).slice(0, max) : null;

async function readJson(response: Response): Promise<unknown> {
  const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (type !== "application/json" && !/^application\/[a-z0-9.+-]+\+json$/.test(type)) return fail("INVALID_RESPONSE", "KONG no devolvió una respuesta JSON verificable.");
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) return fail("INVALID_RESPONSE", "La respuesta de KONG supera el límite permitido.");
  try { return JSON.parse(text); } catch { return fail("INVALID_RESPONSE", "KONG devolvió un JSON inválido."); }
}

function parseTask(body: unknown, token: string): KongOfficeOrderTask {
  const root = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const task = root.task && typeof root.task === "object" ? root.task as Record<string, unknown> : root;
  const rawId = task.taskId ?? task.id;
  const taskId = typeof rawId === "number" && Number.isSafeInteger(rawId) ? String(rawId) : typeof rawId === "string" ? rawId.trim() : "";
  const status = cleanText(task.status, 40, token);
  if (!TASK_ID.test(taskId) || !status || !/^[A-Za-z0-9 _-]+$/.test(status)) return fail("INVALID_RESPONSE", "La respuesta de KONG no trae una tarea válida.");
  const agentValue = typeof task.agent === "object" && task.agent ? (task.agent as Record<string, unknown>).name ?? (task.agent as Record<string, unknown>).id : task.agent;
  // First readable field wins; a KONG result object too long to show falls through to needsOwner/nextAction.
  let result: string | null = null;
  for (const raw of [task.result, task.summary, task.needsOwner, task.nextAction, task.message, task.error]) {
    result = cleanText(raw, 600, token);
    if (!result && raw && typeof raw === "object") { try { const json = JSON.stringify(raw); result = json.length <= 600 ? cleanText(json, 600, token) : null; } catch { /* unreadable */ } }
    if (result) break;
  }
  return { taskId, status, agent: cleanText(agentValue, 120, token), result };
}

export function createKongOfficeOrderClient(deps: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): KongOfficeOrderClient {
  const env = () => deps.env ?? process.env;
  const token = () => env().KONG_OFFICE_ORDER_TOKEN?.trim() || "";

  async function call(method: "GET" | "POST", url: string, body?: unknown, timeoutMs = deps.timeoutMs ?? TIMEOUT_MS): Promise<KongOfficeOrderTask> {
    const secret = token();
    if (!secret) return fail("NOT_CONFIGURED", "El envío de órdenes a KONG no está activado en el servidor de la oficina.");
    if (/[\x00-\x20\x7f]/.test(secret)) return fail("INVALID_CONFIGURATION", "El acceso de órdenes de KONG tiene una configuración inválida.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await (deps.fetchImpl ?? fetch)(url, {
        method, redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { Accept: "application/json", Authorization: `Bearer ${secret}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const kongError = async () => {
        try {
          const parsed = await readJson(response) as Record<string, unknown>;
          const error = parsed?.error;
          if (error && typeof error === "object") {
            const e = error as Record<string, unknown>;
            return { code: typeof e.code === "string" ? e.code : null, message: cleanText(e.message, 200, secret) };
          }
          return { code: null, message: cleanText(error ?? parsed?.message, 200, secret) };
        } catch { return { code: null, message: null }; }
      };
      if (response.status === 429) return fail("RATE_LIMITED", "KONG ya recibió el máximo de órdenes por hora de la oficina (30/hora). Espera un rato y vuelve a enviarla.");
      if (response.status === 503) {
        const info = await kongError();
        if (info.code === "office_orders_disabled") return fail("DISABLED", "KONG todavía no tiene activadas las órdenes de la oficina (falta su token de órdenes).");
        return fail("UNAVAILABLE", "KONG no pudo recibir la orden ahora mismo.");
      }
      if (response.status === 401) return fail("UNAUTHENTICATED", "KONG no aceptó el acceso de órdenes de la oficina (token inválido o caducado).");
      if (response.status === 403) return fail("FORBIDDEN", "KONG no permite a la oficina dar órdenes a ese agente.");
      if (response.status === 404) return fail("NOT_FOUND", "KONG no encontró esa tarea o el servicio de órdenes todavía no existe.");
      if (response.status >= 300 && response.status < 400) return fail("UNAVAILABLE", "KONG intentó redirigir la orden; no se envió.");
      if (response.status === 400 || response.status === 409 || response.status === 422) {
        const reason = (await kongError()).message;
        return fail("REJECTED", `KONG rechazó la orden${reason ? `: ${reason}` : "."}`);
      }
      if (!response.ok) return fail("UNAVAILABLE", "KONG no pudo recibir la orden ahora mismo.");
      return parseTask(await readJson(response), secret);
    } catch (error) {
      if (error instanceof KongOfficeOrderError) throw error;
      // Never keep the fetch error: it may echo headers.
      return fail(controller.signal.aborted ? "TIMEOUT" : "CONNECTION_FAILED", controller.signal.aborted ? "KONG no respondió a tiempo." : "No se pudo conectar con KONG.");
    } finally { clearTimeout(timer); }
  }

  return {
    enabled: () => Boolean(token()),
    async send({ agentId, text, idempotencyKey }) {
      const url = kongOrderUrl(env());
      if (!url) return fail("INVALID_CONFIGURATION", "La dirección de órdenes de KONG configurada no es una URL HTTPS válida.");
      const kongId = kongOrderAgentId(agentId);
      if (!kongId) return fail("REJECTED", "Ese agente no recibe órdenes de KONG.");
      const clean = text.trim();
      if (!clean || clean.length > KONG_ORDER_MAX_TEXT) return fail("REJECTED", `La orden debe tener entre 1 y ${KONG_ORDER_MAX_TEXT} caracteres.`);
      return call("POST", url, { agentId: kongId, text: clean, idempotencyKey });
    },
    async status(taskId) {
      const url = kongOrderUrl(env());
      if (!url) return fail("INVALID_CONFIGURATION", "La dirección de órdenes de KONG configurada no es una URL HTTPS válida.");
      if (!TASK_ID.test(taskId)) return fail("REJECTED", "Tarea de KONG no válida.");
      // Status reads happen while Robert opens a chat: short timeout, the next reopen tries again.
      return call("GET", `${url}/${encodeURIComponent(taskId)}`, undefined, Math.min(deps.timeoutMs ?? TIMEOUT_MS, STATUS_TIMEOUT_MS));
    },
  };
}
