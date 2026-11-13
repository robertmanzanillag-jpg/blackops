import {
  prepareClipperMetricoolExecutionQueue,
  prepareClipperMetricoolPublishingPlan,
  runClipperAutomationCycle,
  type ClipperRunOptions,
} from "./clippers-agent";

export interface MetricoolAutomationInput extends ClipperRunOptions {
  campaign?: string;
  platforms?: string[];
  notes?: string;
}

function normalizePlatform(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["tiktok", "instagram", "youtube", "shorts", "reels"].includes(normalized)) return normalized;
  return null;
}

export function sanitizeMetricoolAutomationInput(input: unknown): MetricoolAutomationInput {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const clipsPerAccount = Number(value.clipsPerAccount);
  const publishMode = value.publishMode === "auto_after_connection" || value.publishMode === "draft_only" || value.publishMode === "approval_required"
    ? value.publishMode
    : "approval_required";
  const riskTolerance = value.riskTolerance === "aggressive" || value.riskTolerance === "safe" || value.riskTolerance === "growth"
    ? value.riskTolerance
    : "growth";
  const platforms = Array.isArray(value.platforms)
    ? Array.from(new Set(value.platforms.map(normalizePlatform).filter(Boolean) as string[]))
    : undefined;

  return {
    clipsPerAccount: Number.isFinite(clipsPerAccount) ? Math.min(Math.max(Math.round(clipsPerAccount), 1), 50) : 8,
    publishMode,
    riskTolerance,
    campaign: typeof value.campaign === "string" ? value.campaign.slice(0, 120) : undefined,
    platforms,
    notes: typeof value.notes === "string" ? value.notes.slice(0, 500) : undefined,
  };
}

export function buildMetricoolPendingDescription(input: MetricoolAutomationInput): string {
  const platforms = input.platforms?.length ? input.platforms.join(", ") : "redes conectadas";
  const campaign = input.campaign ? ` para ${input.campaign}` : "";
  return `Preparar ciclo de clips${campaign}, sincronizar marcas Metricool y generar cola ${input.publishMode} para ${platforms}.`;
}

export function buildDirectMetricoolCommand(message?: string): { content: string; command: string } | null {
  if (!message) return null;
  const text = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const mentionsMetricool = /\bmetricool\b/.test(text);
  const mentionsSocialAutomation = /\b(postear|postea\w*|publicar|publica\w*|programar|programa\w*|subir|sube\w*)\b/.test(text)
    && /\b(auto|automatico|automaticamente|campana|campanas|clips?|tiktok|instagram|reels?|shorts?|redes|social|todo)\b/.test(text);
  const mentionsPublishing = /\b(postear|postea\w*|publicar|publica\w*|programar|programa\w*|schedule|subir|sube\w*|cola|campaign|campana|campanas|clips?|tiktok|instagram|reels?|shorts?|redes|social|todo)\b/.test(text);
  const wantsAction = /\b(crea\w*|haz\w*|prepara\w*|genera\w*|corre\w*|activa\w*|automat\w*|quiero|necesito|dale|postea\w*|publica\w*|programa\w*)\b/.test(text);

  if (!(mentionsMetricool || mentionsSocialAutomation) || !mentionsPublishing || !wantsAction) return null;

  const publishMode = /\b(auto|automatico|automatica|automaticamente|sin aprobar|live|publica ya|postea ya)\b/.test(text)
    ? "auto_after_connection"
    : "approval_required";
  const platforms = [
    text.includes("tiktok") ? "tiktok" : null,
    text.includes("instagram") || text.includes("reel") ? "instagram" : null,
    text.includes("youtube") || text.includes("short") ? "youtube" : null,
  ].filter(Boolean);
  const countMatch = text.match(/\b(\d{1,2})\s*(?:clips?|posts?|videos?)\b/);
  const clipsPerAccount = countMatch ? Number(countMatch[1]) : 8;
  const input = sanitizeMetricoolAutomationInput({
    clipsPerAccount,
    publishMode,
    riskTolerance: text.includes("safe") || text.includes("seguro") ? "safe" : "growth",
    platforms,
    notes: message,
  });

  return {
    content: publishMode === "auto_after_connection"
      ? "Dale. Voy a preparar la cola Metricool en modo automatico, pero quedara bloqueada por aprobacion y por la bandera de publicacion real hasta que todo este habilitado."
      : "Dale. Voy a preparar la cola Metricool en modo approval_required para revisar antes de publicar.",
    command: `[METRICOOL_AUTOMATION: ${JSON.stringify(input)}]`,
  };
}

export async function executeMetricoolAutomationAction(input: unknown, userId: string) {
  const sanitized = sanitizeMetricoolAutomationInput(input);
  const { automation } = await runClipperAutomationCycle({
    clipsPerAccount: sanitized.clipsPerAccount,
    publishMode: sanitized.publishMode,
    riskTolerance: sanitized.riskTolerance,
  }, userId);
  const { metricoolPublishing } = await prepareClipperMetricoolPublishingPlan(userId);
  const { metricoolExecutionQueue } = await prepareClipperMetricoolExecutionQueue(userId);

  const result = {
    sentToMetricool: false,
    reason: metricoolExecutionQueue.realPublishEnabled
      ? "La cola quedo lista para envio real, pero este ejecutor aun no llama el MCP/API de Metricool."
      : "Publicacion real deshabilitada. Requiere CLIPPERS_ENABLE_REAL_PUBLISH=true y METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH=false.",
    automationRunId: automation.id,
    publishMode: automation.publishMode,
    automationTotals: automation.totals,
    metricoolPublishing: {
      status: metricoolPublishing.status,
      mcpReady: metricoolPublishing.mcpReady,
      totals: metricoolPublishing.totals,
      manifestPath: metricoolPublishing.manifestPath,
      markdownPath: metricoolPublishing.markdownPath,
    },
    metricoolExecutionQueue: {
      status: metricoolExecutionQueue.status,
      realPublishEnabled: metricoolExecutionQueue.realPublishEnabled,
      totals: metricoolExecutionQueue.totals,
      manifestPath: metricoolExecutionQueue.manifestPath,
      markdownPath: metricoolExecutionQueue.markdownPath,
      nextStep: metricoolExecutionQueue.nextStep,
    },
  };

  return {
    ...result,
    summary: formatMetricoolAutomationResult(result),
  };
}

export function formatMetricoolAutomationResult(result: any): string {
  const queue = result?.metricoolExecutionQueue;
  const publishing = result?.metricoolPublishing;
  if (!queue || !publishing) return "Metricool: cola preparada.";
  return [
    "Metricool preparado.",
    `Publishing: ${publishing.status} (${publishing.totals?.readyForApprovalQueue || 0}/${publishing.totals?.channels || 0} canales listos).`,
    `Cola: ${queue.status}, ${queue.totals?.queuedForApproval || 0} en aprobacion, ${queue.totals?.readyToSend || 0} ready_to_send, ${queue.totals?.blocked || 0} bloqueados.`,
    `Real publish: ${queue.realPublishEnabled ? "habilitado" : "apagado"}.`,
    queue.nextStep ? `Next: ${queue.nextStep}` : "",
  ].filter(Boolean).join("\n");
}
