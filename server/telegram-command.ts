export type TelegramControlCommand =
  | "help"
  | "readiness"
  | "health"
  | "brief"
  | "top3"
  | "blockers"
  | "chase"
  | "close_day"
  | "pending"
  | "approve"
  | "reject"
  | null;

export function normalizeTelegramCommand(message: string): string {
  return message.trim().toLowerCase().replace(/^\//, "");
}

export function classifyTelegramControlCommand(message: string): TelegramControlCommand {
  const normalized = normalizeTelegramCommand(message);

  if (/^(start|ayuda|help|comandos)\b/.test(normalized)) {
    return "help";
  }

  if (/^(readiness|estado ceo|ceo status|operacion|operación|listo)\b/.test(normalized)) {
    return "readiness";
  }

  if (/^(health|status|salud|diagnostico|diagnóstico|estado sistema)\b/.test(normalized)) {
    return "health";
  }

  if (/^(brief|resumen|agenda|prioridades|estado)\b/.test(normalized)) {
    return "brief";
  }

  if (/^(top 3|top3|foco|prioridad principal|prioridades clave)\b/.test(normalized)) {
    return "top3";
  }

  if (/^(bloqueos|bloqueo|que bloqueo hay|qué bloqueo hay|riesgos|atascos)\b/.test(normalized)) {
    return "blockers";
  }

  if (/^(a quien tengo que perseguir|a quién tengo que perseguir|perseguir|follow ups|follow-ups|seguimientos)\b/.test(normalized)) {
    return "chase";
  }

  if (/^(cerrar dia|cerrar día|cierre del dia|cierre del día|end day|close day)\b/.test(normalized)) {
    return "close_day";
  }

  if (/^(pendientes|aprobaciones|acciones pendientes)\b/.test(normalized)) {
    return "pending";
  }

  if (/^(aprobar|aprueba|autorizar|autoriza)\b/.test(normalized)) {
    return "approve";
  }

  if (/^(rechazar|rechaza|cancelar|cancela)\b/.test(normalized)) {
    return "reject";
  }

  return null;
}
