import type { PendingAction, PendingActionStatus } from "@shared/schema";
import { storage } from "./storage";
import { createPendingActionForApproval, writeAuditLog } from "./trust-policy";
import type { DirectRadioYoutubeCommand } from "./radio-youtube-command";

export const LOCAL_YOUTUBE_WORKER_FLAG = "mac_local_youtube_worker";
const LOCAL_WORKER_PENDING_STATUSES = new Set<PendingActionStatus>(["pending", "snoozed", "edited"]);

type LocalYoutubeWorkerInput = {
  youtubeUrl: string;
  driveFolderPath: string[];
  driveParentFolderId?: string;
  createFolderIfMissing?: boolean;
  driveFolderPathFromYoutubeTitle?: boolean;
  djName?: string;
  musicUrl?: string;
  instagramClipCount?: number;
  tiktokClipCount?: number;
  deleteSourceAfterSuccess?: boolean;
  localWorkerOnly: true;
  localWorker: typeof LOCAL_YOUTUBE_WORKER_FLAG;
};

function actionInput(action: Pick<PendingAction, "input" | "editedInput">): Record<string, unknown> {
  return ((action.editedInput || action.input || {}) as Record<string, unknown>) || {};
}

export function isLocalYoutubeWorkerAction(action: Pick<PendingAction, "actionType" | "status" | "input" | "editedInput">): boolean {
  const input = actionInput(action);
  return (
    action.actionType === "radio_edit.youtube_to_drive" &&
    LOCAL_WORKER_PENDING_STATUSES.has(action.status) &&
    input.localWorkerOnly === true &&
    input.localWorker === LOCAL_YOUTUBE_WORKER_FLAG
  );
}

export function buildLocalYoutubeWorkerInput(command: DirectRadioYoutubeCommand): LocalYoutubeWorkerInput {
  return {
    youtubeUrl: command.youtubeUrl,
    driveFolderPath: command.driveFolderPath,
    driveParentFolderId: command.driveParentFolderId,
    createFolderIfMissing: command.createFolderIfMissing,
    driveFolderPathFromYoutubeTitle: command.driveFolderPathFromYoutubeTitle,
    djName: command.djName,
    musicUrl: command.musicUrl,
    instagramClipCount: command.instagramClipCount,
    tiktokClipCount: command.tiktokClipCount,
    deleteSourceAfterSuccess: command.deleteSourceAfterSuccess !== false,
    localWorkerOnly: true,
    localWorker: LOCAL_YOUTUBE_WORKER_FLAG,
  };
}

export function shouldQueueYoutubeForLocalWorker(): boolean {
  const configured = process.env.RADIO_YOUTUBE_LOCAL_WORKER_MODE?.trim();
  return !/^(0|false|off|none|disabled|replit)$/i.test(configured || "");
}

export function formatLocalYoutubeWorkerQueuedMessage(actionId: string): string {
  return [
    "Recibido. Dejé el YouTube en cola para tu Mac.",
    "Si la Mac está apagada, no pasa nada: se queda esperando.",
    "Cuando abras la Mac y el worker esté corriendo, va a descargar el video con tu Chrome local, crear los clips, subirlos a Drive y borrar el video largo local.",
    `ID de cola: ${actionId}`,
    "Gasto estimado de esta edición: $0.00 USD.",
  ].join("\n");
}

export async function queueRadioYoutubeForLocalWorker(params: {
  userId: string;
  command: DirectRadioYoutubeCommand;
  origin: "telegram" | "web" | "scheduler";
}): Promise<PendingAction> {
  const input = buildLocalYoutubeWorkerInput(params.command);
  const existing = (await storage.getPendingActions(params.userId)).find((action) => {
    const existingInput = actionInput(action);
    return (
      action.actionType === "radio_edit.youtube_to_drive" &&
      existingInput.localWorkerOnly === true &&
      existingInput.localWorker === LOCAL_YOUTUBE_WORKER_FLAG &&
      action.resourceId === params.command.youtubeUrl &&
      ["pending", "edited", "snoozed", "approved", "executing"].includes(action.status)
    );
  });
  if (existing) return existing;

  const driveLabel = params.command.driveParentFolderId
    ? "carpeta enviada por link"
    : params.command.driveFolderPath.join("/") || "carpeta de Google Drive";
  const pendingAction = await createPendingActionForApproval({
    userId: params.userId,
    actorType: "assistant",
    actorId: "telegram-radio-youtube-local-worker",
    origin: params.origin,
    executionMode: "user_requested",
    actionType: "radio_edit.youtube_to_drive",
    resourceType: "youtube_video",
    resourceId: params.command.youtubeUrl,
    title: "Crear clips desde YouTube en Mac local",
    description: `Trabajo en cola para Mac local. YouTube: ${params.command.youtubeUrl}. Destino Drive: ${driveLabel}.`,
    input,
    proposedChanges: {
      ...input,
      expectedRunner: "Mac local",
      expectedCleanup: "Borrar MP4 fuente local despues de subir clips",
      estimatedCostUsd: 0,
    },
    metadata: {
      status: "queued_for_mac_local_worker",
      localWorker: LOCAL_YOUTUBE_WORKER_FLAG,
    },
    scope: "system",
  });

  await writeAuditLog({
    userId: params.userId,
    actorType: "assistant",
    actorId: "telegram-radio-youtube-local-worker",
    origin: params.origin,
    actionType: "radio_edit.youtube_to_drive",
    resourceType: "youtube_video",
    resourceId: params.command.youtubeUrl,
    pendingActionId: pendingAction.id,
    metadata: {
      status: "queued_for_mac_local_worker",
      localWorker: LOCAL_YOUTUBE_WORKER_FLAG,
    },
    status: "queued",
    executionMode: "user_requested",
  });

  return pendingAction;
}
