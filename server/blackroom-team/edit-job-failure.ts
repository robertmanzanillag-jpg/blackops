// Why a Black Room edit job ended "failed". Shared by the scripts agent (which stores it) and the
// lessons harvester (which scores only real render failures). Pure, no imports: keeps lessons.ts light.

/**
 * Only "render" is the scripts agent's own fault (scored). The rest (restart mid-render, a pipeline
 * confirmation waiting for Robert, missing Drive/pipeline setup) teach a lesson but never cost life.
 */
export type BlackRoomEditJobFailureKind = "interrupted" | "awaiting_confirmation" | "setup" | "render";

const SETUP_FAILURE = /\b(drive|oauth|token|credencial|credential|permiso|permission|unauthori[sz]ed|401|403|no (esta )?configurad\w*|not configured|missing|falta|enoent|pipeline)\b/i;
const INTERRUPTED_ERROR = /se interrumpio|posible reinicio/i;
const AWAITING_CONFIRMATION_ERROR = /confirmacion pendiente/i;

/** Classifies a render error message: setup/infrastructure problems vs real render failures. */
export function classifyBlackRoomRenderFailure(error: string | null | undefined): Extract<BlackRoomEditJobFailureKind, "setup" | "render"> {
  return error && SETUP_FAILURE.test(error) ? "setup" : "render";
}

/** The job's stored failure kind; for older jobs without one, inferred from the error text. */
export function editJobFailureKind(job: { failureKind?: BlackRoomEditJobFailureKind | null; error?: string | null }): BlackRoomEditJobFailureKind {
  if (job.failureKind === "interrupted" || job.failureKind === "awaiting_confirmation" || job.failureKind === "setup" || job.failureKind === "render") return job.failureKind;
  const error = typeof job.error === "string" ? job.error : "";
  if (INTERRUPTED_ERROR.test(error)) return "interrupted";
  if (AWAITING_CONFIRMATION_ERROR.test(error)) return "awaiting_confirmation";
  return classifyBlackRoomRenderFailure(error);
}
