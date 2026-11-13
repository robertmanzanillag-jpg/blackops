import { BLACKROOM_OFFICE_POLICY, type BlackRoomOfficeOperations, type BlackRoomOfficeAction } from "../shared/blackroom-office-operations";
import type { BlackRoomRemoteControlState } from "./blackroom-remote-control";
import { canonicalLearningPostId, evaluateBlackRoomLearning } from "./blackroom-verified-learning";
import { learningSourceHealth } from "./blackroom-learning-observations";

const HEARTBEAT_MAX_AGE_MS = 90_000;
const count = (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Derive office evidence from persisted worker receipts and source observations.
 * No model call, provider request, publication, repair or deletion happens here.
 * A fresh page read NEVER refreshes the worker/metrics timestamps. */
export function buildBlackRoomOfficeOperations(remote: BlackRoomRemoteControlState, now = new Date()): BlackRoomOfficeOperations {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid office observation clock");
  const seenAt = remote.device?.seenAt || null;
  const age = now.getTime() - Date.parse(seenAt || "");
  const online = Number.isFinite(age) && age >= 0 && age <= HEARTBEAT_MAX_AGE_MS;
  const queue = object(remote.device?.queue);
  const totals = object(queue.totals);
  const worker = object(remote.device?.worker);
  const generationApplied = online && Number.isSafeInteger(remote.device?.appliedGeneration)
    && remote.device!.appliedGeneration === remote.generation;
  const events = (Array.isArray(worker.activity) ? worker.activity : []).map(object)
    .filter(event => typeof event.id === "string" && event.id.length > 0 && typeof event.createdAt === "string"
      && ["info", "success", "error"].includes(String(event.level))
      && now.getTime() - Date.parse(event.createdAt) >= 0)
    // At an equal timestamp an error wins; input ordering must not hide a failure.
    .sort((a, b) => Date.parse(String(b.createdAt)) - Date.parse(String(a.createdAt))
      || Number(b.level === "error") - Number(a.level === "error"));
  const latest = events[0];
  const workerFailed = Boolean(typeof remote.device?.lastError === "string" && remote.device.lastError.trim())
    || Boolean(typeof worker.lastError === "string" && worker.lastError.trim())
    || count(totals.retry) > 0 || latest?.level === "error";
  // Only stages actually emitted after successful validation/editing/confirmation
  // qualify as recent progress. Generic info/start events are not completion proof.
  const successfulStages = new Set(["video", "audio", "edición", "tiktok", "facebook", "youtube", "completado"]);
  const progress = latest?.level === "success" && successfulStages.has(String(latest.stage))
    && now.getTime() - Date.parse(String(latest.createdAt)) <= HEARTBEAT_MAX_AGE_MS ? latest : undefined;
  // A PID or running flag alone is not evidence of advancing work. The event ID
  // lets the council deduplicate scoring instead of rewarding the same read twice.
  const processing = online && remote.desiredEnabled && generationApplied && !workerFailed
    && Boolean(progress) && (worker.running === true || count(totals.processing) > 0);
  const actions: BlackRoomOfficeAction[] = [];
  const action = (entry: Omit<BlackRoomOfficeAction, "executed">) => actions.push({ ...entry, executed: false });
  if (remote.desiredEnabled && !online) action({ id: "restore-worker", owner: "mechanic", severity: "critical", message: "El publicador no envía señales recientes. Revisar conexión y servicio existente; no iniciar otro publicador ni retirar protecciones." });
  if (remote.desiredEnabled && online && !generationApplied) action({ id: "apply-generation", owner: "blackroom-videos", severity: "warning", message: "La orden aún no está aplicada por el publicador. Conciliar la generación antes de enviar otra." });
  if (remote.desiredEnabled && workerFailed) action({ id: "inspect-worker-error", owner: "mechanic", severity: "critical", message: "El publicador reporta un error o reintento pendiente. Revisar el fallo y conciliar recibos antes de repetir una publicación." });
  // Historical scheduler receipts do not prove a current calendar: cancelled or moved posts
  // can remain in the experiment ledger. Never claim 14-day coverage from aggregate totals.
  action({ id: "verify-calendar", owner: "blackroom-videos", severity: "warning", message: "Verificar en el calendario vigente 3–5 clips únicos por día y red; los totales históricos no prueban cobertura." });
  if (count(queue.postsPerDay) > BLACKROOM_OFFICE_POLICY.maximumDailyClips) action({ id: "review-cadence", owner: "marketing", severity: "warning", message: "La cola supera el objetivo autorizado de 3–5 clips diarios. Revisar sin borrar ni duplicar publicaciones." });
  const sourceObservedAt = Object.fromEntries(BLACKROOM_OFFICE_POLICY.networks.map(network => {
    const timestamps = (remote.analyticsImports[network]?.samples || []).map(sample => sample.observedAt)
      .filter((value): value is string => typeof value === "string" && learningSourceHealth(value, now).status !== "invalid")
      .sort((a, b) => Date.parse(b) - Date.parse(a));
    return [network, timestamps[0] || null];
  }));
  const decisions = evaluateBlackRoomLearning({ snapshots: remote.learningSnapshots || [], experiments: remote.publicationExperiments, sourceObservedAt, now });
  const learning = Object.fromEntries(BLACKROOM_OFFICE_POLICY.networks.map(network => {
    const samples = remote.analyticsImports[network]?.samples || [];
    const identities = new Map<string, Set<string>>();
    for (const experiment of remote.publicationExperiments) {
      if (experiment.network !== network || !experiment.reservationId) continue;
      const id = canonicalLearningPostId(network, experiment.platformPostId || "");
      if (!id) continue;
      const reservations = identities.get(id) || new Set<string>();
      reservations.add(JSON.stringify([experiment.reservationId, experiment.dj, experiment.sourceVideoId,
        experiment.durationSeconds, experiment.format, experiment.language, experiment.creativeStrategy,
        experiment.segmentStartSeconds, experiment.segmentEndSeconds]));
      identities.set(id, reservations);
    }
    const sampleIds = new Set(samples.map(sample => canonicalLearningPostId(network, sample.id)).filter((id): id is string => Boolean(id)));
    const exactAttributed = [...sampleIds].filter(id => identities.get(id)?.size === 1).length;
    const d = decisions[network];
    return [network, { sourceObservedAt: sourceObservedAt[network], sourceStatus: learningSourceHealth(sourceObservedAt[network], now).status,
      samples: sampleIds.size, exactAttributed, comparableSnapshots: d.matchedSnapshots,
      status: d.status, provisionalWinner: d.winner, reason: d.reason }];
  })) as BlackRoomOfficeOperations["learning"];
  if (Object.values(learning).some(item => item.sourceStatus !== "fresh")) action({ id: "restore-metrics", owner: "marketing", severity: "critical", message: "Faltan métricas recientes de una o más redes. Recuperar la captura existente; no declarar aprendizaje ni subir volumen con datos antiguos." });
  if (Object.values(learning).some(item => item.samples > item.exactAttributed)) action({ id: "reconcile-identities", owner: "marketing", severity: "warning", message: "Hay resultados sin vínculo exacto al clip. Conciliar identificadores oficiales; no adivinar por título, hora o DJ." });
  return {
    checkedAt: now.toISOString(), policy: BLACKROOM_OFFICE_POLICY,
    state: !remote.desiredEnabled ? "paused" : !online || !generationApplied || workerFailed ? "blocked" : processing ? "working" : "waiting",
    worker: { online, seenAt, generationApplied, processing, progressEventId: progress ? String(progress.id) : null, progressAt: progress ? String(progress.createdAt) : null },
    queue: { queued: count(totals.queued), processing: count(totals.processing), retry: count(totals.retry), scheduled: count(totals.scheduled), completed: count(totals.completed), authoritative: online },
    coverage: { status: "unverified", reason: "Requiere conciliación con el calendario vigente, no solo contadores o experimentos históricos." },
    learning, actions,
    execution: { publisherOwner: "existing-worker", newPublisherStarted: false, requiresWorkerOnline: true, cloud24x7Verified: false },
  };
}

/** Production integration seam: reuse the company's existing persisted BR state.
 * Dependency injection permits a no-network QA fixture and avoids a second scheduler. */
export async function readBlackRoomOfficeOperations(options: {
  readRemote?: () => Promise<BlackRoomRemoteControlState>;
  now?: Date;
} = {}): Promise<BlackRoomOfficeOperations> {
  const readRemote = options.readRemote || (await import("./blackroom-remote-control")).readBlackRoomRemoteControl;
  return buildBlackRoomOfficeOperations(await readRemote(), options.now);
}
