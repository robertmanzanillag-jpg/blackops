import type { PendingAction } from "@shared/schema";
import { storage } from "./storage";
import { createCalendarEvent, updateCalendarEvent, updateCalendarEventDescription } from "./google-calendar";
import { writeAuditLog } from "./trust-policy";
import { addBlackRoomCountdown, addBlackRoomLink, deactivateBlackRoomLink, updateBlackRoomLink } from "./blackroom-links";
import { createGoogleDriveFolderPath } from "./google-drive-folder-command";
import { executeMetricoolAutomationAction } from "./metricool-chat-actions";
import { processDriveRadioVideoFile, processYoutubeRadioVideoLink, resumeRadioVideoEditWithDjName } from "./radio-video-edit-agent";

type JsonRecord = Record<string, any>;

function actionInput(action: PendingAction): JsonRecord {
  return ((action.editedInput || action.input || {}) as JsonRecord) || {};
}

export async function executeApprovedPendingAction(
  action: PendingAction,
  actorId: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  if (action.status !== "approved") {
    return { success: false, error: "Action must be approved before execution" };
  }

  await storage.updatePendingAction(action.id, { status: "executing" });
  await storage.createPendingActionEvent({
    pendingActionId: action.id,
    userId: action.userId,
    actorType: "user",
    actorId,
    eventType: "executing",
    previousStatus: action.status,
    nextStatus: "executing",
    note: null,
    metadata: null,
  });

  try {
    const input = actionInput(action);
    let result: unknown;

    switch (action.actionType) {
      case "calendar.create_event": {
        const eventId = await createCalendarEvent({
          title: input.title,
          date: input.date,
          endDate: input.endDate,
          description: input.description,
        });
        result = { eventId, title: input.title };
        break;
      }

      case "calendar.modify_radio": {
        await updateCalendarEventDescription(input.eventId, input.description);
        const tasks = await storage.getTasks(action.userId);
        const taskToUpdate = tasks.find((task) => task.externalId === input.eventId);
        if (taskToUpdate) {
          await storage.updateTask(taskToUpdate.id, { description: input.description });
        }
        result = { eventId: input.eventId, updatedLocalTask: !!taskToUpdate };
        break;
      }

      case "calendar.update_event": {
        await updateCalendarEvent({
          eventId: input.eventId,
          title: input.title,
          date: input.date,
          endDate: input.endDate,
          description: input.description,
          location: input.location,
          isAllDay: input.isAllDay,
        });
        const tasks = await storage.getTasks(action.userId);
        const taskToUpdate = tasks.find((task) => task.externalId === input.eventId);
        if (taskToUpdate) {
          await storage.updateTask(taskToUpdate.id, {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
            ...(input.endDate !== undefined ? { endDate: new Date(input.endDate) } : {}),
          });
        }
        result = { eventId: input.eventId, updatedLocalTask: !!taskToUpdate };
        break;
      }

      case "finance.create_investment": {
        const investment = await storage.createInvestment(action.userId, {
          symbol: String(input.symbol).toUpperCase(),
          name: input.name,
          type: input.type,
          quantity: String(input.quantity),
          avgBuyPrice: String(input.avgBuyPrice),
          currency: input.currency || "USD",
          notes: input.notes,
        });
        result = investment;
        break;
      }

      case "finance.update_investment": {
        const investments = await storage.getInvestments(action.userId);
        const existing = investments.find((investment) => investment.symbol.toUpperCase() === String(input.symbol).toUpperCase());
        if (!existing) throw new Error(`No investment found for ${input.symbol}`);

        const updates: { quantity?: string; avgBuyPrice?: string; notes?: string } = {};
        if (input.quantity !== undefined) updates.quantity = String(input.quantity);
        if (input.avgBuyPrice !== undefined) updates.avgBuyPrice = String(input.avgBuyPrice);
        if (input.notes !== undefined) updates.notes = input.notes;

        const investment = await storage.updateInvestment(existing.id, updates);
        result = investment;
        break;
      }

      case "finance.delete_investment": {
        const investments = await storage.getInvestments(action.userId);
        const existing = investments.find((investment) => investment.symbol.toUpperCase() === String(input.symbol).toUpperCase());
        if (!existing) throw new Error(`No investment found for ${input.symbol}`);

        await storage.deleteInvestment(existing.id);
        result = { deleted: true, symbol: String(input.symbol).toUpperCase(), investmentId: existing.id };
        break;
      }

      case "communications.send": {
        result = {
          draftOnly: true,
          sent: false,
          recipient: input.recipient,
          channel: input.channel,
          subject: input.subject || null,
          message: input.message,
          note: "Communication integrations are not connected yet. Draft approved for manual send.",
        };
        break;
      }

      case "marketing.blackroom_link_add": {
        result = await addBlackRoomLink(input as any);
        break;
      }

      case "marketing.blackroom_link_update": {
        result = await updateBlackRoomLink(input as any);
        break;
      }

      case "marketing.blackroom_link_deactivate": {
        result = await deactivateBlackRoomLink(input as any);
        break;
      }

      case "marketing.blackroom_timer_add": {
        result = await addBlackRoomCountdown(input as any);
        break;
      }

      case "marketing.metricool_automation": {
        result = await executeMetricoolAutomationAction(input, action.userId);
        break;
      }

      case "radio_edit.resolve_dj_name": {
        result = await resumeRadioVideoEditWithDjName({ ...input, userId: action.userId } as any);
        break;
      }

      case "radio_edit.youtube_to_drive": {
        const radioYoutubeResult = await processYoutubeRadioVideoLink({
          userId: action.userId,
          youtubeUrl: input.youtubeUrl,
          driveFolderPath: input.driveFolderPath,
          driveParentFolderId: input.driveParentFolderId,
          createFolderIfMissing: Boolean(input.createFolderIfMissing),
          driveFolderPathFromYoutubeTitle: Boolean(input.driveFolderPathFromYoutubeTitle),
          force: Boolean(input.force),
          djName: input.djName,
          musicUrl: input.musicUrl,
          musicPath: input.musicPath,
          instagramClipCount: Number.isFinite(Number(input.instagramClipCount)) ? Number(input.instagramClipCount) : undefined,
          tiktokClipCount: Number.isFinite(Number(input.tiktokClipCount)) ? Number(input.tiktokClipCount) : undefined,
          deleteSourceAfterSuccess: input.deleteSourceAfterSuccess !== false,
        });
        if (radioYoutubeResult.status === "failed") {
          throw new Error(radioYoutubeResult.error || "No pude procesar el link de YouTube para radio");
        }
        result = radioYoutubeResult;
        break;
      }

      case "radio_edit.drive_video_to_drive": {
        const radioDriveVideoResult = await processDriveRadioVideoFile({
          userId: action.userId,
          sourceDriveFileId: input.sourceDriveFileId,
          sourceDriveUrl: input.sourceDriveUrl,
          driveFolderPath: input.driveFolderPath,
          driveParentFolderId: input.driveParentFolderId,
          createFolderIfMissing: Boolean(input.createFolderIfMissing),
          force: Boolean(input.force),
          djName: input.djName,
          musicUrl: input.musicUrl,
          musicPath: input.musicPath,
          instagramClipCount: Number.isFinite(Number(input.instagramClipCount)) ? Number(input.instagramClipCount) : undefined,
          tiktokClipCount: Number.isFinite(Number(input.tiktokClipCount)) ? Number(input.tiktokClipCount) : undefined,
          deleteSourceAfterSuccess: input.deleteSourceAfterSuccess !== false,
        });
        if (radioDriveVideoResult.status === "failed") {
          throw new Error(radioDriveVideoResult.error || "No pude procesar el MP4 de Google Drive para radio");
        }
        result = radioDriveVideoResult;
        break;
      }

      case "google_drive.create_folder": {
        result = await createGoogleDriveFolderPath({
          userId: action.userId,
          driveFolderPath: input.driveFolderPath,
          origin: "web",
        });
        break;
      }

      case "agent_council.lesson":
      case "agent_council.skill_update":
      case "agent_council.new_agent":
      case "agent_council.repair": {
        // Safe by design: records the approval in the council (lesson or ready PR-first brief).
        // It never edits code, skills or agents.
        const { getAgentCouncil } = await import("./agent-council");
        const proposalKey = String(input.proposalKey || "");
        if (!proposalKey) throw new Error("Propuesta del consejo sin proposalKey");
        await getAgentCouncil().approveFromTrustCenter(proposalKey);
        result = { applied: true, proposalKey };
        break;
      }

      default:
        throw new Error(`No executor registered for ${action.actionType}`);
    }

    await storage.updatePendingAction(action.id, {
      status: "executed",
      executionResult: result as any,
      executedAt: new Date(),
    });
    await storage.createPendingActionEvent({
      pendingActionId: action.id,
      userId: action.userId,
      actorType: "user",
      actorId,
      eventType: "executed",
      previousStatus: "executing",
      nextStatus: "executed",
      note: null,
      metadata: { result },
    });

    await writeAuditLog({
      userId: action.userId,
      actorType: "user",
      actorId,
      origin: "web",
      actionType: action.actionType,
      resourceType: action.resourceType,
      resourceId: action.resourceId || undefined,
      pendingActionId: action.id,
      metadata: { result },
      status: "succeeded",
      executionMode: "user_requested",
    });

    return { success: true, result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await storage.updatePendingAction(action.id, {
      status: "failed",
      executionResult: { error: errorMessage },
    });
    await storage.createPendingActionEvent({
      pendingActionId: action.id,
      userId: action.userId,
      actorType: "user",
      actorId,
      eventType: "failed",
      previousStatus: "executing",
      nextStatus: "failed",
      note: errorMessage,
      metadata: { error: errorMessage },
    });
    await writeAuditLog({
      userId: action.userId,
      actorType: "user",
      actorId,
      origin: "web",
      actionType: action.actionType,
      resourceType: action.resourceType,
      resourceId: action.resourceId || undefined,
      pendingActionId: action.id,
      metadata: { error: errorMessage },
      status: "failed",
      executionMode: "user_requested",
      errorMessage,
    });
    return { success: false, error: errorMessage };
  }
}
