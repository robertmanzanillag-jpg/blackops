// The supervisor reviews existing read-only signals. It does not produce videos,
// contact promoters, give legal advice or execute commercial orders.
export const KONG_WORKERS = ["kong-videos", "kong:KONG AI", "kong:Promoters + Mesas", "kong:Venues", "kong:Kong Legal"] as const;
export type KongWorkerId = typeof KONG_WORKERS[number];
export type SupervisionResult = "completed" | "blocked" | "failed";
export type SupervisionRecord = {
  agentId: KongWorkerId;
  task: "review-readiness";
  checkedAt: string;
  result: SupervisionResult;
  reason: string;
};
export const KONG_SUPERVISOR_ID = "kong-supervisor";
export type KongChatAgentId = KongWorkerId | typeof KONG_SUPERVISOR_ID;
export type KongChatMessage = { id: string; requestId: string; agentId: KongChatAgentId; at: string; role: "user" | "assistant"; text: string };
export type KongSupervision = { version: 1; owner: "kong-supervisor"; lastRunAt: string | null; records: SupervisionRecord[]; messages: KongChatMessage[] };
export function isKongChatAgentId(value: unknown): value is KongChatAgentId {
  return typeof value === "string" && (value === KONG_SUPERVISOR_ID || KONG_WORKERS.some(id => id === value));
}
export function emptyKongSupervision(): KongSupervision {
  return { version: 1, owner: "kong-supervisor", lastRunAt: null, records: [], messages: [] };
}
export function parseKongSupervision(value: unknown): KongSupervision {
  const input = value as Partial<KongSupervision> | null;
  if (!input || input.version !== 1 || !Array.isArray(input.records)) return emptyKongSupervision();
  const records = input.records.filter((item): item is SupervisionRecord => Boolean(item) && KONG_WORKERS.includes(item.agentId) && item.task === "review-readiness" && ["completed", "blocked", "failed"].includes(item.result) && typeof item.reason === "string" && typeof item.checkedAt === "string" && Number.isFinite(Date.parse(item.checkedAt))).slice(0, 50);
  const messages = Array.isArray(input.messages) ? input.messages.filter((item): item is KongChatMessage => Boolean(item) && isKongChatAgentId(item.agentId) && typeof item.id === "string" && typeof item.requestId === "string" && typeof item.at === "string" && Number.isFinite(Date.parse(item.at)) && ["user", "assistant"].includes(item.role) && typeof item.text === "string").slice(-80).map(item => ({ ...item, text: item.text.slice(0, 2000) })) : [];
  return { version: 1, owner: "kong-supervisor", lastRunAt: typeof input.lastRunAt === "string" && Number.isFinite(Date.parse(input.lastRunAt)) ? input.lastRunAt : null, records, messages };
}
// Only the video reader exists in this application. Other roles remain blocked here
// until their existing owners are connected; this does not assert they lack an external service.
export function reviewKongReadiness(previous: KongSupervision, statuses: Record<string, { state: string }>, now: number): KongSupervision {
  const checkedAt = new Date(now).toISOString();
  const records: SupervisionRecord[] = KONG_WORKERS.map((agentId) => {
    const base = { agentId, task: "review-readiness" as const, checkedAt };
    if (agentId !== "kong-videos") return { ...base, result: "blocked", reason: "Integracion no conectada a este supervisor. No se ha ejecutado una orden ni evaluado al productor externo." };
    const signal = statuses[agentId];
    if (!signal || signal.state === "checking") return { ...base, result: "blocked", reason: "No hay una lectura de estado disponible en este ciclo." };
    if (signal.state === "offline") return { ...base, result: "blocked", reason: "El servicio informa contenido desactualizado; requiere una entrega reciente." };
    if (signal.state === "error") return { ...base, result: "failed", reason: "La lectura de estado del servicio de video no esta disponible." };
    if (signal.state === "needs-setup") return { ...base, result: "blocked", reason: "El servicio de video informa dependencias o contenido pendientes." };
    if (signal.state !== "working") return { ...base, result: "blocked", reason: "El servicio no aporta un estado reconocido." };
    return { ...base, result: "completed", reason: "Revision de disponibilidad completada con una lectura del servicio. No se produjo ni publico contenido." };
  });
  return { ...previous, version: 1, owner: "kong-supervisor", lastRunAt: checkedAt, records: [...records, ...previous.records].slice(0, 50) };
}
