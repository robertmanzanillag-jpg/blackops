import { looksLikeBlackRoomAssistantRequest, parseBlackRoomChatCommand } from "./blackroom-chat";
import {
  appendBlackRoomRemoteCommand,
  isBlackRoomRemoteDeviceOnline,
  mutateBlackRoomRemoteControl,
  readBlackRoomRemoteControl,
  setBlackRoomRemoteCommand,
  type BlackRoomRemoteControlState,
} from "./blackroom-remote-control";

export { looksLikeBlackRoomAssistantRequest };

export function formatBlackRoomChatStatus(state: BlackRoomRemoteControlState, now = new Date()): string {
  const queue = state.device?.queue as { totals?: Record<string, number> } | undefined;
  const totals = queue?.totals || {};
  const device = isBlackRoomRemoteDeviceOnline(state, now) ? "Mac conectada" : "Mac desconectada";
  const activity = state.desiredEnabled ? "activado" : "pausado";
  if (!queue) return `BlackRoom está ${activity}. ${device}; todavía no hay un reporte reciente de la cola.`;
  return `BlackRoom está ${activity}. ${device}. Cola: ${Number(totals.queued || 0)} pendientes, ${Number(totals.processing || 0)} procesando, ${Number(totals.retry || 0)} reintentos, ${Number(totals.scheduled || 0)} agendados y ${Number(totals.completed || 0)} completados.`;
}

export type BlackRoomChatActorRole = "owner" | "partner";

/** Commands that change autonomous public posting: owner-only (start/pause/volume). */
const OWNER_ONLY_CHAT_COMMANDS = new Set(["daily_target", "extra_posts", "work_now"]);

export const PARTNER_CHAT_CONTROL_REFUSAL =
  "Como socio no puedes activar, pausar ni cambiar la cantidad de publicaciones de BlackRoom. Robert decide eso; tu mensaje quedo en el historial para que lo vea. Puedes revisar el estado, los analytics, sugerir una URL o aprobar posts en el Publicador.";

/**
 * Applies a parsed chat message to the remote-control state. Partners can ask for status,
 * analytics and priority sources, but never start/pause the agent or add/raise public posts:
 * that would bypass the Publicador per-post approval flow.
 */
export function applyBlackRoomChatMessage(
  state: BlackRoomRemoteControlState,
  message: string,
  parsed: ReturnType<typeof parseBlackRoomChatCommand>,
  baseReply: string,
  actorRole: BlackRoomChatActorRole,
): { reply: string; command: ReturnType<typeof parseBlackRoomChatCommand>["command"]; refused: boolean } {
  const refused = actorRole === "partner" && Boolean(parsed.control || (parsed.command && OWNER_ONLY_CHAT_COMMANDS.has(parsed.command.type)));
  const reply = refused ? PARTNER_CHAT_CONTROL_REFUSAL : baseReply;
  const command = refused ? null : parsed.command;
  if (!refused && parsed.control) {
    setBlackRoomRemoteCommand(state, parsed.control.enabled, parsed.control.weeks ?? state.weeks);
  }
  appendBlackRoomRemoteCommand(state, { message, reply, command });
  return { reply, command, refused };
}

export async function executeBlackRoomChatMessage(message: string, options: { actorRole?: BlackRoomChatActorRole } = {}): Promise<{
  reply: string;
  command: ReturnType<typeof parseBlackRoomChatCommand>["command"];
  remote: BlackRoomRemoteControlState;
}> {
  const actorRole = options.actorRole ?? "owner";
  const current = await readBlackRoomRemoteControl();
  const deviceQueue = current.device?.queue as { postsPerDay?: number; analytics?: { sampleCount?: number } } | undefined;
  const parsed = parseBlackRoomChatCommand(message, {
    analyticsSamples: Number(deviceQueue?.analytics?.sampleCount || 0),
    currentPostsPerDay: Number(deviceQueue?.postsPerDay || 7),
  });
  const baseReply = parsed.statusRequested ? formatBlackRoomChatStatus(current) : parsed.reply;
  let outcome: { reply: string; command: ReturnType<typeof parseBlackRoomChatCommand>["command"] } = { reply: baseReply, command: parsed.command };
  const remote = await mutateBlackRoomRemoteControl((state) => {
    outcome = applyBlackRoomChatMessage(state, message, parsed, baseReply, actorRole);
  });
  return { reply: outcome.reply, command: outcome.command, remote };
}
