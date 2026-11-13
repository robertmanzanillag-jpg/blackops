import {
  KONG_SUPERVISOR_ID, KONG_WORKERS, isKongChatAgentId, reviewKongReadiness,
  type KongChatAgentId, type KongChatMessage, type KongSupervision,
} from "../shared/kong-supervisor";

export class KongConversationInputError extends Error {}
export type KongConversationInput = { agentId: KongChatAgentId; message: string; requestId: string };
export type KongConversationDeps = {
  now: () => number;
  // Must be the council's existing serialized mutation queue, with atomic persistence.
  commit: (change: (state: KongSupervision) => Promise<KongSupervision>) => Promise<KongSupervision>;
  read: () => Promise<KongSupervision>;
  // Existing read-only video status function; never a producer or scheduler.
  readVideoStatus: () => Promise<{ state: string }>;
};
const HELP = 'Puedo responder "estado" y "ayuda", o ejecutar "revisar" para comprobar disponibilidad. La revision solo lee estado; no edita videos, publica, contacta personas ni ejecuta ordenes comerciales.';
const NAMES: Record<KongChatAgentId, string> = {
  "kong-supervisor": "Supervisor KONG", "kong-videos": "Videos Kong", "kong:KONG AI": "KONG AI",
  "kong:Promoters + Mesas": "Promoters + Mesas", "kong:Venues": "Venues", "kong:Kong Legal": "Kong Legal",
};
export function validateKongConversationInput(value: unknown): KongConversationInput {
  const v = value as Partial<KongConversationInput> | null;
  if (!v || !isKongChatAgentId(v.agentId)) throw new KongConversationInputError("Selecciona un agente KONG valido.");
  if (typeof v.message !== "string" || !v.message.trim() || v.message.trim().length > 500) throw new KongConversationInputError("Escribe entre 1 y 500 caracteres.");
  if (typeof v.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(v.requestId)) throw new KongConversationInputError("La solicitud necesita un identificador valido.");
  return { agentId: v.agentId, message: v.message.trim(), requestId: v.requestId };
}
function statusReply(state: KongSupervision, id: KongChatAgentId) {
  const ids = id === KONG_SUPERVISOR_ID ? KONG_WORKERS : [id];
  return ids.map(agentId => {
    const record = state.records.find(item => item.agentId === agentId);
    return record ? `${NAMES[agentId]} — ${record.result === "completed" ? "revision completada" : record.result === "failed" ? "lectura con error" : "bloqueado"} (${record.checkedAt}): ${record.reason}` : `${NAMES[agentId]} — sin revision registrada. Escribe "revisar" para comprobarlo.`;
  }).join("\n");
}
async function limitedRead(work: () => Promise<{ state: string }>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 10_000); })]);
  } catch {
    return { state: "error" };
  } finally { clearTimeout(timer); }
}
export function createKongSupervisorConversation(deps: KongConversationDeps) {
  async function talk(value: unknown) {
    const input = validateKongConversationInput(value);
    const normalized = input.message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.!?¿¡]+$/g, "").trim();
    // The persistence layer may replay a mutation after a revision conflict.
    // Reuse one observed read for this request instead of repeating external IO.
    let observation: Promise<{ state: string }> | undefined;
    const state = await deps.commit(async previous => {
      // Retrying a completed request does not create duplicate tasks or messages.
      if (previous.messages.some(item => item.requestId === input.requestId && item.agentId === input.agentId && item.role === "assistant")) return previous;
      let next = previous;
      let reply: string;
      if (["revisar", "revisar estado", "revisa", "comprobar estado"].includes(normalized)) {
        const isSupervisor = input.agentId === KONG_SUPERVISOR_ID;
        const readsVideo = isSupervisor || input.agentId === "kong-videos";
        const lastVideo = previous.records.find(record => record.agentId === "kong-videos");
        const age = lastVideo ? deps.now() - Date.parse(lastVideo.checkedAt) : Infinity;
        if (readsVideo && age >= 0 && age < 60_000) {
          reply = `Ya hay una revision de video de hace menos de un minuto. No se inicio otra lectura.\n${statusReply(previous, input.agentId)}`;
        } else {
        const statuses: Record<string, { state: string }> = readsVideo ? { "kong-videos": await (observation ||= limitedRead(deps.readVideoStatus)) } : {};
        const report = reviewKongReadiness(previous, statuses, deps.now());
        const newRecords = report.records.slice(0, KONG_WORKERS.length).filter(record => isSupervisor || record.agentId === input.agentId);
        next = { ...previous, lastRunAt: report.lastRunAt, records: [...newRecords, ...previous.records].slice(0, 50) };
        reply = `Tarea interna: revision de disponibilidad.\n${statusReply(next, input.agentId)}\nNo se ha ejecutado una orden comercial.`;
        }
      } else if (["estado", "mi estado", "como estas", "que estas haciendo"].includes(normalized)) {
        reply = statusReply(previous, input.agentId);
      } else if (["ayuda", "hola", "que puedes hacer", "capacidades"].includes(normalized)) {
        reply = `${NAMES[input.agentId]}. ${HELP}`;
      } else {
        reply = `Tu solicitud no se ha ejecutado. ${HELP}`;
      }
      const at = new Date(deps.now()).toISOString();
      const messages: KongChatMessage[] = [
        { id: `${input.requestId}-user`, requestId: input.requestId, agentId: input.agentId, at, role: "user", text: input.message },
        { id: `${input.requestId}-assistant`, requestId: input.requestId, agentId: input.agentId, at, role: "assistant", text: reply },
      ];
      return { ...next, messages: [...previous.messages, ...messages].slice(-80) };
    });
    return { state, reply: state.messages.find(item => item.requestId === input.requestId && item.agentId === input.agentId && item.role === "assistant") || null };
  }
  return { talk, view: deps.read };
}
