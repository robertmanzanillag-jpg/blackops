import { z } from "zod";
import type { OfficeKongAgent } from "../server/office-kong";

export const WHATSAPP_AGENT_ID = "whatsapp_reader";
export const WHATSAPP_CAREER_ID = `kong:${WHATSAPP_AGENT_ID}`;
export const WHATSAPP_SCOPE_ID = "kong-venues-four-groups";
const timestamp = z.string().datetime({ offset: true });
// No chat text, group identifiers, URLs, phone numbers or checkpoint values cross this boundary.
export const whatsappReaderEvidenceSchema = z.object({
  version: z.literal(1),
  scopeId: z.literal(WHATSAPP_SCOPE_ID),
  ownerId: z.string().uuid(),
  observedAt: timestamp,
  scheduler: z.enum(["active", "paused", "unknown"]),
  intervalMinutes: z.number().int().min(1).max(1440),
  reader: z.enum(["reading", "idle", "blocked", "unknown"]),
  session: z.enum(["connected", "disconnected", "unknown"]),
  lastAttemptAt: timestamp.nullable(),
  lastReviewAt: timestamp.nullable().optional(),
  lastSuccessAt: timestamp.nullable(),
  groupsRead: z.number().int().min(0).max(4),
  lastSuccessGroupCount: z.number().int().min(0).max(4),
  blocker: z.enum(["none", "missing-reference", "session-unavailable", "permission-required", "interaction-failed", "transport-unavailable"]),
  checkpointsRetained: z.boolean(),
}).strict();
export type WhatsAppReaderEvidence = z.infer<typeof whatsappReaderEvidenceSchema>;
export type WhatsAppOfficeView = {
  evidence: WhatsAppReaderEvidence | null;
  status: "reading" | "recent" | "blocked" | "stale" | "unverified";
  label: string;
  detail: string;
};
export const WHATSAPP_BLOCKERS = {
  none: "Sin bloqueo reportado",
  "missing-reference": "Falta la referencia autorizada a los grupos",
  "session-unavailable": "La sesión no está disponible para el lector",
  "permission-required": "Falta autorización para acceder a la lectura",
  "interaction-failed": "Falló la interacción de lectura",
  "transport-unavailable": "La oficina no recibe evidencia del lector",
} as const;

export function whatsappOfficeView(input: unknown, now = Date.now(), transportCurrent = true): WhatsAppOfficeView {
  const parsed = whatsappReaderEvidenceSchema.safeParse(input);
  const missing = { evidence: null, status: "unverified", label: "No conectado", detail: "La oficina no recibe evidencia verificable del lector." } as const;
  if (!parsed.success || !Number.isFinite(now)) return missing;
  const evidence = parsed.data;
  const observed = Date.parse(evidence.observedAt);
  const attempt = evidence.lastAttemptAt === null ? null : Date.parse(evidence.lastAttemptAt);
  const success = evidence.lastSuccessAt === null ? null : Date.parse(evidence.lastSuccessAt);
  const review = evidence.lastReviewAt ? Date.parse(evidence.lastReviewAt) : null;
  if ([observed, attempt, success, review].some(time => time !== null && time > now) || (review !== null && review > observed) ||
      (attempt !== null && attempt > observed) || (success !== null && (attempt === null || success > attempt)) ||
      (success === null && evidence.lastSuccessGroupCount !== 0)) return missing;
  if (!transportCurrent) return { evidence, status: "stale", label: "Estado sin confirmar", detail: "La conexión de la oficina no está vigente. Se conserva la última evidencia, sin confirmar actividad actual." };
  // An idle scheduled reader reports once per cycle, not every five minutes.
  // This credits only the recorded read; it never asserts a live session.
  if (evidence.scheduler === "active" && evidence.reader === "idle" && evidence.blocker === "none" &&
      evidence.session === "connected" && success !== null && evidence.lastSuccessGroupCount === 4 &&
      now - success <= Math.min(60, evidence.intervalMinutes * 2) * 60_000) {
    return { evidence, status: "recent", label: "Última lectura completa verificada", detail: "Lectura registrada dentro de la cadencia programada; no confirma que esté leyendo ni conectado ahora." };
  }
  if (now - observed > 5 * 60_000) return { evidence, status: "stale", label: "Estado obsoleto", detail: "La última observación tiene más de cinco minutos; no confirma actividad actual." };
  if (evidence.reader === "blocked" || evidence.blocker !== "none" || evidence.session === "disconnected") {
    return { evidence, status: "blocked", label: "Lector bloqueado", detail: evidence.blocker === "none" ? "La sesión de lectura no está disponible." : WHATSAPP_BLOCKERS[evidence.blocker] };
  }
  if (evidence.reader === "reading" && evidence.session === "connected" && attempt !== null && now - attempt <= 2 * 60_000) {
    return { evidence, status: "reading", label: "Lectura en curso verificada", detail: "El lector reporta una lectura actual de su alcance autorizado." };
  }
  if (evidence.reader === "idle" && evidence.session === "connected" && success !== null &&
      evidence.lastSuccessGroupCount === 4 && now - success <= Math.min(60, evidence.intervalMinutes * 2) * 60_000) {
    return { evidence, status: "recent", label: "Última lectura completa verificada", detail: "Lectura reciente de los cuatro grupos; no significa que esté leyendo ahora." };
  }
  return { evidence, status: "unverified", label: "Lectura sin verificar", detail: "La programación activa o un intento reciente no acreditan una lectura exitosa." };
}

export function whatsappOfficeAgent(input: unknown, now = Date.now(), transportCurrent = true): OfficeKongAgent {
  const view = whatsappOfficeView(input, now, transportCurrent);
  return {
    id: WHATSAPP_AGENT_ID, name: "Vigilancia WhatsApp", kind: "system",
    owner: view.evidence?.ownerId ?? "Propietario del lector sin verificar",
    responsibility: "Revisar únicamente los cuatro grupos autorizados, sin enviar mensajes.",
    state: view.status === "reading" ? "running" : view.status === "recent" ? "healthy" : view.status === "blocked" ? "attention" : view.status === "stale" ? "stale" : "unknown",
    lastRunAt: view.evidence?.lastSuccessAt ?? null, nextRunAt: null,
    blocker: view.status === "reading" || view.status === "recent" ? null : view.detail,
    nextAction: "Conservar el propietario y los checkpoints del lector existente; recuperar su transporte de evidencia.",
    issues: [],
  };
}

/** Replaces any unqualified claim for this ID, never creates a second reader or changes its scope. */
export function withWhatsAppOfficeAgent(agents: readonly OfficeKongAgent[], input: unknown, now = Date.now(), transportCurrent = true): OfficeKongAgent[] {
  return [...agents.filter(agent => agent.id !== WHATSAPP_AGENT_ID), whatsappOfficeAgent(input, now, transportCurrent)];
}
