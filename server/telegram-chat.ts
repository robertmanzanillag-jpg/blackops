import type { Content, Part } from "@google/genai";
import { storage } from "./storage";
import { sendTelegramMessage, sendTelegramPlainMessage, sendTelegramPlainMessageChunks, TelegramUpdate, setTelegramWebhook, getWebhookInfo } from "./telegram";
import { getCalendarEvents, isGoogleCalendarConnected } from "./google-calendar";
import { format, addMonths, startOfWeek, endOfWeek, addDays } from "date-fns";
import { es } from "date-fns/locale";
import { createPendingActionForApproval, writeAuditLog } from "./trust-policy";
import { executeApprovedPendingAction } from "./trust-executor";
import { generateCeoRoutineCommand, generateTelegramAssistantContext } from "./ceo-briefing";
import { getReminderSchedulerConfig } from "./reminder-scheduler";
import { classifyTelegramControlCommand } from "./telegram-command";
import { buildCeoReadinessReport } from "./ceo-readiness";
import { DEFAULT_DEV_USER_ID, allowsDevUserFallback } from "./user-context";
import { getCeoConversationHistory, saveCeoConversationMessage } from "./ceo-conversation-history";
import { executeMultipleActions } from "./agent-actions";
import { parseDjNameResolutionCommand } from "./radio-video-edit-agent";
import { buildDirectGoogleDriveFolderCommand, createGoogleDriveFolderPath, formatGoogleDriveFolderCreateResult } from "./google-drive-folder-command";
import { buildDirectRadioDriveVideoCommand, buildDirectRadioYoutubeCommand, directRadioDriveVideoCommandNeedsDriveFolder, directRadioYoutubeCommandNeedsDriveFolder, executeDirectRadioDriveVideoCommand, executeDirectRadioYoutubeCommand, formatRadioDriveVideoResult, formatRadioYoutubeResult } from "./radio-youtube-command";
import { formatLocalYoutubeWorkerQueuedMessage, queueRadioYoutubeForLocalWorker, shouldQueueYoutubeForLocalWorker } from "./local-youtube-worker-queue";
import { buildDirectMetricoolCommand, buildMetricoolPendingDescription, sanitizeMetricoolAutomationInput } from "./metricool-chat-actions";
import { buildClaudeSkillContext } from "./claude-skill-bridge";
import { buildAiCostPolicyContext, getAiConversationHistoryLimit } from "./ai-cost-policy";
import { hasRealValue, hasStrongSecret } from "./ceo-doctor-cli";
import { createDeveloperAutopilotHandoff } from "./developer-autopilot";
import { getGeminiChatModel, getGeminiClient } from "./gemini-client";
import type { PendingActionStatus } from "@shared/schema";

const TELEGRAM_WEBHOOK_PATH = "/api/telegram/webhook";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function resolveTelegramWebhookUrl(): string | null {
  const explicitUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim();
  if (hasRealValue(explicitUrl)) return explicitUrl;

  const publicAppUrl = process.env.PUBLIC_APP_URL?.trim();
  if (hasRealValue(publicAppUrl)) return `${trimTrailingSlash(publicAppUrl)}${TELEGRAM_WEBHOOK_PATH}`;

  const replitDomains = process.env.REPLIT_DOMAINS?.trim();
  if (replitDomains) {
    const domain = replitDomains.split(",").map((item) => item.trim()).find(Boolean);
    if (domain) return `https://${domain}${TELEGRAM_WEBHOOK_PATH}`;
  }

  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}${TELEGRAM_WEBHOOK_PATH}`;
  }

  if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
    return `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co${TELEGRAM_WEBHOOK_PATH}`;
  }

  return null;
}

async function downloadTelegramPhoto(botToken: string, fileId: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const fileResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const fileData = await fileResponse.json();
    
    if (!fileData.ok || !fileData.result?.file_path) {
      console.error("[Telegram] Failed to get file path:", fileData);
      return null;
    }
    
    const filePath = fileData.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    
    const imageResponse = await fetch(fileUrl);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    
    const ext = filePath.split(".").pop()?.toLowerCase() || "jpg";
    const mimeType = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
    
    console.log("[Telegram] Downloaded image:", { filePath, size: arrayBuffer.byteLength, mimeType });
    return { base64, mimeType };
  } catch (error) {
    console.error("[Telegram] Error downloading photo:", error);
    return null;
  }
}

export interface TelegramMessageHandlerDeps {
  getBotToken(): string | undefined;
  getAiKey(): string | undefined;
  getTelegramConfigByChatId(chatId: string): Promise<{ userId: string; enabled: boolean } | undefined>;
  saveTelegramConfig(userId: string, chatId: string): Promise<{ userId: string; enabled: boolean }>;
  sendPlainMessage(botToken: string, chatId: string, text: string): Promise<boolean>;
  sendPlainMessageChunks(botToken: string, chatId: string, text: string): Promise<boolean>;
  saveConversationMessage(userId: string, role: "user" | "assistant", content: string): Promise<void>;
  handleControlCommand(userId: string, message: string): Promise<string | null>;
  handleWorkRequest(userId: string, message: string): Promise<string | null>;
}

const defaultTelegramMessageHandlerDeps: TelegramMessageHandlerDeps = {
  getBotToken: () => process.env.TELEGRAM_BOT_TOKEN,
  getAiKey: () => process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  getTelegramConfigByChatId: (chatId) => storage.getTelegramConfigByChatId(chatId),
  saveTelegramConfig: (userId, chatId) => storage.saveTelegramConfig(userId, chatId),
  sendPlainMessage: sendTelegramPlainMessage,
  sendPlainMessageChunks: sendTelegramPlainMessageChunks,
  saveConversationMessage: saveCeoConversationMessage,
  handleControlCommand: handleTelegramControlCommand,
  handleWorkRequest: handleTelegramWorkRequest,
};

async function getCalendarContext(): Promise<string> {
  try {
    const isConnected = await isGoogleCalendarConnected();
    if (!isConnected) {
      return "Google Calendar no está conectado.";
    }
    const startDate = new Date();
    const endDate = addMonths(startDate, 12);
    const events = await getCalendarEvents(startDate, endDate);
    if (!events || events.length === 0) {
      return "No hay eventos en el calendario para los próximos 12 meses.";
    }
    
    // Separar eventos de Radio (usar title, no summary)
    const radioEvents = events.filter((e: any) => 
      e.title?.toLowerCase().includes("radio")
    );
    const otherEvents = events.filter((e: any) => 
      !e.title?.toLowerCase().includes("radio")
    ).slice(0, 15);
    
    let context = "📅 CALENDARIO DE GOOGLE:\n";
    
    if (radioEvents.length > 0) {
      context += "\n🎵 EVENTOS DE RADIO (con eventId para modificar):\n";
      radioEvents.forEach((e: any) => {
        // e.date is already a Date object from getCalendarEvents
        const dateStr = e.date ? format(e.date, "EEEE d 'de' MMMM yyyy", { locale: es }) : "Sin fecha";
        context += `\n📻 ${dateStr}\n`;
        context += `   eventId: ${e.id}\n`;
        // Limpiar HTML de la descripción
        const cleanDesc = e.description 
          ? e.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
          : "Sin DJs asignados";
        context += `   DJs: ${cleanDesc.substring(0, 150)}\n`;
      });
    }
    
    if (otherEvents.length > 0) {
      context += "\n📌 OTROS EVENTOS:\n";
      otherEvents.forEach((e: any) => {
        const dateStr = e.date ? format(e.date, "EEE d MMM", { locale: es }) : "?";
        context += `- ${dateStr}: ${e.title || "Sin título"}\n`;
      });
    }
    
    return context;
  } catch (error) {
    console.error("Error getting calendar context:", error);
    return "Error al obtener eventos del calendario.";
  }
}

async function getUserProfileContext(userId: string): Promise<string> {
  try {
    const profileData = await storage.getUserProfileData(userId);
    if (!profileData || profileData.length === 0) {
      return "";
    }
    const grouped: Record<string, string[]> = {};
    for (const item of profileData) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(`${item.key}: ${item.value}`);
    }
    let context = "Información personal del usuario:\n";
    for (const [category, items] of Object.entries(grouped)) {
      context += `\n${category}:\n${items.map(i => `  - ${i}`).join("\n")}`;
    }
    return context;
  } catch (error) {
    return "";
  }
}

async function getPortfolioContext(userId: string): Promise<string> {
  try {
    const investments = await storage.getInvestments(userId);
    if (!investments || investments.length === 0) {
      return "El usuario no tiene inversiones registradas.";
    }
    const invList = investments.map(i => 
      `- ${i.symbol} (${i.name}): ${i.quantity} unidades a $${i.avgBuyPrice} promedio`
    ).join("\n");
    return `Portafolio de inversiones:\n${invList}`;
  } catch (error) {
    return "";
  }
}

async function getTasksContext(userId: string): Promise<string> {
  try {
    const tasks = await storage.getTasks(userId);
    const today = new Date();
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
    
    const todayTasks = tasks.filter(t => {
      const taskDate = new Date(t.date);
      return taskDate.toDateString() === today.toDateString();
    });
    
    const weekTasks = tasks.filter(t => {
      const taskDate = new Date(t.date);
      return taskDate >= weekStart && taskDate <= weekEnd;
    });
    
    const radioEvents = tasks.filter(t => 
      t.type === "event" && t.title.toLowerCase().includes("radio")
    ).slice(0, 10);
    
    let context = "";
    
    if (todayTasks.length > 0) {
      const list = todayTasks.map(t => 
        `- ${t.completed ? "✅" : "⏳"} ${t.title}${t.priority === "high" ? " (ALTA PRIORIDAD)" : ""}`
      ).join("\n");
      context += `\n📅 TAREAS DE HOY (${format(today, "EEEE d MMMM", { locale: es })}):\n${list}`;
    } else {
      context += `\n📅 No hay tareas para hoy.`;
    }
    
    if (radioEvents.length > 0) {
      const radioList = radioEvents.map(e => {
        const date = format(new Date(e.date), "EEE d MMM", { locale: es });
        return `- ${date}: ${e.title}\n  ${e.description || "Sin DJs asignados"}`;
      }).join("\n");
      context += `\n\n🎵 PRÓXIMOS EVENTOS DE RADIO:\n${radioList}`;
    }
    
    return context;
  } catch (error) {
    console.error("Error getting tasks context:", error);
    return "";
  }
}

function getTelegramSystemPrompt(): string {
  const now = new Date();
  const dateStr = format(now, "EEEE d 'de' MMMM yyyy, HH:mm", { locale: es });
  
  return `Eres un asistente personal inteligente que responde por Telegram.
Tu nombre es BlackOps Assistant y funcionas como CEO Assistant personal. Ayudas con:
- Gestión de tareas y recordatorios
- Calendario y eventos (especialmente eventos de Radio los miércoles)
- Portafolio de inversiones
- Información personal guardada
- Seguimiento ejecutivo: prioridades, riesgos, decisiones, aprobaciones, proyectos y próximos pasos

FECHA Y HORA ACTUAL: ${dateStr} (zona horaria: Los Angeles/Pacific)

REGLAS IMPORTANTES:
- Responde SIEMPRE en español
- Sé conciso pero informativo (máximo 3-4 párrafos)
- No uses formato HTML ni markdown complejo, solo texto plano con emojis
- Puedes usar emojis para hacer las respuestas más amigables
- PUEDES ejecutar acciones directamente, no necesitas que el usuario vaya a la app web
- Para acciones sensibles, informa que quedan pendientes de aprobación y muestra el ID.
- Si el usuario quiere aprobar o rechazar una acción, dile que puede escribir "aprobar ID" o "rechazar ID".

COMANDOS DISPONIBLES (úsalos cuando sea apropiado):
- [CREAR_TAREA: {"title": "...", "date": "YYYY-MM-DDTHH:mm:ss", "priority": "normal|high|low"}]
- [CREAR_FOLLOWUP: {"person": "...", "topic": "...", "date": "YYYY-MM-DDTHH:mm:ss", "channel": "telegram|email|call|whatsapp", "notes": "...", "priority": "normal|high|low"}]
- [GUARDAR_DECISION: {"title": "...", "decision": "...", "context": "..."}]
- [GUARDAR_PERSONA: {"name": "...", "role": "...", "company": "...", "notes": "..."}]
- [GUARDAR_COMPROMISO: {"owner": "...", "commitment": "...", "dueAt": "YYYY-MM-DDTHH:mm:ss", "context": "..."}]
- [CREAR_BORRADOR_COMUNICACION: {"recipient": "...", "channel": "email|telegram|whatsapp|slack|sms", "subject": "...", "message": "...", "context": "..."}]
- [GUARDAR_INFO: {"category": "...", "key": "...", "value": "..."}]
- [CREAR_RECORDATORIO: {"message": "...", "hour": 8, "minute": 0, "daysOfWeek": ["monday", "tuesday"]}]
- [GOOGLE_DRIVE_CREATE_FOLDER: {"driveFolderPath": ["Robert A", "Videos de Black Room", "Radio Junio"]}]
- [METRICOOL_AUTOMATION: {"clipsPerAccount": 8, "publishMode": "approval_required|auto_after_connection|draft_only", "riskTolerance": "safe|growth|aggressive", "platforms": ["tiktok", "instagram"], "campaign": "...", "notes": "..."}]
- [MODIFICAR_RADIO: {"eventId": "ID_DEL_EVENTO", "description": "7: DJ1\\n8: DJ2\\n9: DJ3"}]
- [RADIO_YOUTUBE_CLIPS: {"youtubeUrl": "https://youtube.com/...", "driveFolderPath": ["Robert A", "Videos de Black Room", "Radio Junio"], "createFolderIfMissing": true, "djName": "LUCIA REINA", "musicUrl": "https://youtube.com/...", "instagramClipCount": 3, "tiktokClipCount": 3, "deleteSourceAfterSuccess": true}]
- [RADIO_DRIVE_VIDEO_CLIPS: {"sourceDriveFileId": "GOOGLE_DRIVE_FILE_ID", "sourceDriveUrl": "https://drive.google.com/file/d/...", "driveFolderPath": ["Robert A", "Videos de Black Room", "Radio Junio"], "createFolderIfMissing": true, "djName": "LUCIA REINA", "musicUrl": "https://youtube.com/...", "instagramClipCount": 3, "tiktokClipCount": 3, "deleteSourceAfterSuccess": true}]
- [AGREGAR_INVERSION: {"symbol": "AAPL", "name": "Apple Inc", "type": "stock", "quantity": "10", "avgBuyPrice": "150.50"}]
- [ACTUALIZAR_INVERSION: {"symbol": "AAPL", "quantity": "15", "avgBuyPrice": "145.00"}]
- [ELIMINAR_INVERSION: {"symbol": "AAPL"}]

INFORMACIÓN SOBRE RADIO:
- Los eventos de Radio son los MIÉRCOLES
- La descripción del evento tiene el formato: "7: nombre_dj\\n8: nombre_dj\\n9: nombre_dj"
- 7, 8, 9 representan las horas (7pm, 8pm, 9pm Pacific)
- Cada Radio tiene un eventId (externalId) único que necesitas para modificarlo
- Si un slot está vacío, aparece como "7:" o "7: " (sin nombre)
- Si el usuario manda un YouTube y pide sacar clips/videos de radio, usa RADIO_YOUTUBE_CLIPS. Necesitas driveFolderPath; si no dice carpeta de Drive, pregunta antes.
- Si el usuario pide crear carpeta/subcarpeta en el mismo mensaje, incluye createFolderIfMissing:true. Si solo pide guardar en una carpeta, deja que el sistema confirme si no existe.
- Si el usuario dice el DJ o aparece claro en el contexto, incluye djName. Si no, el sistema intenta leerlo abajo a la izquierda del video y pregunta si no lo encuentra.
- Por defecto genera 1 clip para Instagram 4:5 y 1 clip para TikTok/Reels 9:16. Si el usuario pide cantidad, usa instagramClipCount y tiktokClipCount; “3 de IG y TikTok” significa 3 y 3 con momentos distintos.
- Si pide canción/audio/música/drop sin segundo link, usa el drop del mismo video fuente. Si manda un segundo link, usa ese audio externo.
- Para YouTube, usa deleteSourceAfterSuccess:true salvo que el usuario pida conservar el video largo; el sistema borra solo el MP4 fuente descargado después de subir los clips.
- Si YouTube bloquea la descarga y el usuario manda un link de archivo MP4 de Google Drive, usa RADIO_DRIVE_VIDEO_CLIPS. El sistema descarga ese MP4 temporalmente, crea clips, los sube a Drive y borra el MP4 local al completar.
- Si el usuario pide crear carpetas o subcarpetas en Google Drive, usa GOOGLE_DRIVE_CREATE_FOLDER. Si no dice la ruta/nombre exacto, pregunta antes.

METRICOOL / SOCIAL PUBLISHING:
- Si el usuario pide postear, publicar, programar, correr campanas, preparar cola o automatizar clips/redes con Metricool, usa METRICOOL_AUTOMATION.
- Usa publishMode:"approval_required" por defecto.
- Usa publishMode:"auto_after_connection" solo si pide automatico/live explicitamente. Aun asi quedara pendiente de aprobacion.
- Nunca digas que ya publicaste en redes. Di que queda cola preparada o pendiente de aprobacion.

TIPOS DE INVERSIÓN: stock, etf, crypto, bond, fund`;
}

function extractActionId(text: string): string | null {
  const match = text.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
  return match?.[1] || null;
}

function telegramPlain(text: string): string {
  return text.replace(/&/g, "and").replace(/[<>]/g, "").trim();
}

async function recordPendingActionDecision(
  userId: string,
  actionId: string,
  nextStatus: PendingActionStatus,
  note: string | null,
): Promise<void> {
  const action = await storage.getPendingAction(actionId);
  if (!action || action.userId !== userId) {
    throw new Error("No encontré esa acción pendiente para este usuario.");
  }

  const updated = await storage.updatePendingAction(action.id, {
    status: nextStatus,
    approvalReason: nextStatus === "approved" ? note : action.approvalReason,
    rejectionReason: nextStatus === "rejected" ? note : action.rejectionReason,
    approvedBy: nextStatus === "approved" ? userId : action.approvedBy,
    approvedAt: nextStatus === "approved" ? new Date() : action.approvedAt,
  });

  await storage.createPendingActionEvent({
    pendingActionId: action.id,
    userId,
    actorType: "user",
    actorId: "telegram-user",
    eventType: nextStatus === "approved" ? "approved" : "rejected",
    previousStatus: action.status,
    nextStatus,
    note,
    metadata: { origin: "telegram" },
  });

  await writeAuditLog({
    userId,
    actorType: "user",
    actorId: "telegram-user",
    origin: "telegram",
    actionType: updated.actionType,
    resourceType: updated.resourceType,
    resourceId: updated.resourceId || undefined,
    pendingActionId: updated.id,
    metadata: { decision: nextStatus, note },
    status: nextStatus === "approved" ? "queued" : "blocked",
    executionMode: "user_requested",
  });
}

async function handleTelegramControlCommand(userId: string, message: string): Promise<string | null> {
  const djNameResolution = parseDjNameResolutionCommand(message);
  if (djNameResolution) {
    const action = await storage.getPendingAction(djNameResolution.actionId);
    if (!action || action.userId !== userId || action.actionType !== "radio_edit.resolve_dj_name") {
      return "No encontré ese pendiente de video de radio para este usuario.";
    }
    if (!["pending", "edited", "snoozed", "failed"].includes(action.status)) {
      return `Ese pendiente ya está en estado ${action.status}.`;
    }

    const editedInput = {
      ...((action.input || {}) as Record<string, unknown>),
      ...((action.editedInput || {}) as Record<string, unknown>),
      djName: djNameResolution.djName,
    };

    await storage.updatePendingAction(action.id, {
      status: "approved",
      editedInput,
      approvedBy: userId,
      approvedAt: new Date(),
      approvalReason: "Nombre del DJ recibido por Telegram",
    });
    await storage.createPendingActionEvent({
      pendingActionId: action.id,
      userId,
      actorType: "user",
      actorId: "telegram-user",
      eventType: "edited",
      previousStatus: action.status,
      nextStatus: "approved",
      note: `Nombre del DJ: ${djNameResolution.djName}`,
      metadata: { origin: "telegram", editedInput },
    });

    const approvedAction = await storage.getPendingAction(action.id);
    if (!approvedAction) return "Guardé el nombre, pero no pude recargar el pendiente.";

    const result = await executeApprovedPendingAction(approvedAction, userId);
    if (!result.success) {
      return `Guardé el nombre ${djNameResolution.djName}, pero falló el render: ${result.error}`;
    }
    return `✅ Listo. Guardé ${djNameResolution.djName} y generé los clips de radio.`;
  }

  const directRadioDriveVideoCommand = buildDirectRadioDriveVideoCommand(message);
  if (directRadioDriveVideoCommand) {
    if (directRadioDriveVideoCommandNeedsDriveFolder(directRadioDriveVideoCommand) || directRadioDriveVideoCommand.needsMusicUrl) {
      return directRadioDriveVideoCommand.content;
    }

    try {
      const result = await executeDirectRadioDriveVideoCommand(directRadioDriveVideoCommand, userId);
      return formatRadioDriveVideoResult(result);
    } catch (error) {
      return `No pude procesar ese MP4 de Drive para radio: ${error instanceof Error ? error.message : "error desconocido"}`;
    }
  }

  const directRadioYoutubeCommand = buildDirectRadioYoutubeCommand(message);
  if (directRadioYoutubeCommand) {
    if (directRadioYoutubeCommandNeedsDriveFolder(directRadioYoutubeCommand) || directRadioYoutubeCommand.needsMusicUrl) {
      return directRadioYoutubeCommand.content;
    }

    if (shouldQueueYoutubeForLocalWorker()) {
      try {
        const pendingAction = await queueRadioYoutubeForLocalWorker({
          userId,
          command: directRadioYoutubeCommand,
          origin: "telegram",
        });
        return formatLocalYoutubeWorkerQueuedMessage(pendingAction.id);
      } catch (error) {
        return `No pude dejar ese YouTube en cola para la Mac: ${error instanceof Error ? error.message : "error desconocido"}`;
      }
    }

    try {
      const result = await executeDirectRadioYoutubeCommand(directRadioYoutubeCommand, userId);
      return formatRadioYoutubeResult(result);
    } catch (error) {
      return `No pude procesar ese YouTube para radio: ${error instanceof Error ? error.message : "error desconocido"}`;
    }
  }

  const directGoogleDriveFolderCommand = buildDirectGoogleDriveFolderCommand(message);
  if (directGoogleDriveFolderCommand) {
    if (!directGoogleDriveFolderCommand.driveFolderPath.length) {
      return directGoogleDriveFolderCommand.content;
    }

    try {
      const result = await createGoogleDriveFolderPath({
        userId,
        driveFolderPath: directGoogleDriveFolderCommand.driveFolderPath,
        origin: "telegram",
      });
      return formatGoogleDriveFolderCreateResult(result);
    } catch (error) {
      return `No pude crear esa carpeta en Google Drive: ${error instanceof Error ? error.message : "error desconocido"}`;
    }
  }

  const directMetricoolCommand = buildDirectMetricoolCommand(message);
  if (directMetricoolCommand) {
    try {
      const match = directMetricoolCommand.command.match(/\[METRICOOL_AUTOMATION:\s*(\{[^}]+\})\]/);
      const metricoolData = sanitizeMetricoolAutomationInput(JSON.parse(match ? match[1] : "{}"));
      const pendingAction = await createPendingActionForApproval({
        userId,
        actorType: "assistant",
        actorId: "telegram-assistant",
        origin: "telegram",
        executionMode: "user_requested",
        actionType: "marketing.metricool_automation",
        resourceType: "metricool_execution_queue",
        title: metricoolData.publishMode === "auto_after_connection" ? "Preparar Metricool auto publish" : "Preparar cola Metricool",
        description: buildMetricoolPendingDescription(metricoolData),
        input: metricoolData,
        proposedChanges: metricoolData,
      });
      return `${directMetricoolCommand.content}\n\nPendiente de aprobacion: ${pendingAction.id}\nEscribe "aprobar ${pendingAction.id}" para ejecutarlo.`;
    } catch (error) {
      return `No pude preparar Metricool: ${error instanceof Error ? error.message : "error desconocido"}`;
    }
  }

  const command = classifyTelegramControlCommand(message);

  if (command === "help") {
    return [
      "Comandos de Telegram:",
      "",
      "brief / resumen / agenda / prioridades - ver estado CEO",
      "top 3 / foco - ver las tres prioridades principales",
      "bloqueos / riesgos - ver atascos operativos",
      "a quién tengo que perseguir - ver follow-ups y compromisos abiertos",
      "cerrar día - checklist ejecutivo de cierre",
      "readiness / estado CEO - revisar si el assistant esta listo",
      "health / status / estado sistema - revisar salud de Telegram",
      "pendientes / aprobaciones - ver acciones esperando aprobación",
      "aprobar ID - aprobar y ejecutar una acción",
      "rechazar ID - rechazar una acción",
      "También puedes hablar normal: crear tareas, pedir agenda, preguntar por portafolio o mandar capturas.",
    ].join("\n");
  }

  if (command === "readiness") {
    return buildTelegramCeoReadiness(userId);
  }

  if (command === "health") {
    return buildTelegramHealthStatus(userId);
  }

  if (command === "brief") {
    return generateTelegramAssistantContext(userId);
  }

  if (command === "top3" || command === "blockers" || command === "chase" || command === "close_day") {
    return generateCeoRoutineCommand(userId, command);
  }

  if (command === "pending") {
    const actions = (await storage.getPendingActions(userId))
      .filter((action) => action.status === "pending" || action.status === "draft" || action.status === "edited")
      .slice(0, 10);

    if (actions.length === 0) return "No tienes acciones pendientes de aprobación.";

    return [
      "🛡️ Acciones pendientes:",
      "",
      ...actions.map((action) => `${action.id}\n${telegramPlain(action.title)}\nRiesgo: ${action.riskLevel}\nEscribe: aprobar ${action.id} o rechazar ${action.id}`),
    ].join("\n\n");
  }

  if (command === "approve") {
    const actionId = extractActionId(message);
    if (!actionId) return "Pásame el ID completo de la acción. Ejemplo: aprobar 00000000-0000-0000-0000-000000000000";

    await recordPendingActionDecision(userId, actionId, "approved", "Aprobado desde Telegram");
    const action = await storage.getPendingAction(actionId);
    if (!action) return "Aprobada, pero no pude volver a cargar la acción.";

    const result = await executeApprovedPendingAction(action, userId);
    if (!result.success) {
      return `Aprobé la acción, pero falló al ejecutarse: ${result.error}`;
    }
    return `✅ Acción aprobada y ejecutada: ${telegramPlain(action.title)}`;
  }

  if (command === "reject") {
    const actionId = extractActionId(message);
    if (!actionId) return "Pásame el ID completo de la acción. Ejemplo: rechazar 00000000-0000-0000-0000-000000000000";

    await recordPendingActionDecision(userId, actionId, "rejected", "Rechazado desde Telegram");
    return "🚫 Acción rechazada.";
  }

  return null;
}

function normalizeTelegramText(message: string): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function routeTelegramWorkRequest(message: string): string[] {
  const text = normalizeTelegramText(message);
  const actionIds = new Set<string>();

  const asksToWork = includesAny(text, [
    "revisa",
    "analiza",
    "haz",
    "hacer",
    "dame",
    "manda",
    "envia",
    "prepara",
    "chequea",
    "check",
    "actualiza",
    "detecta",
    "busca",
    "resumen",
    "reporte",
    "estado",
    "que tengo",
    "que hay",
  ]);

  if (!asksToWork) return [];

  if (includesAny(text, ["radio", "dj", "djs", "slot", "slots", "evento"])) {
    actionIds.add("radio_analyze");
    if (includesAny(text, ["manda", "envia", "telegram", "notifica", "reporte"])) {
      actionIds.add("radio_notify_slots");
    }
    if (includesAny(text, ["importa", "historial", "djs anteriores"])) {
      actionIds.add("radio_import_djs");
    }
  }

  if (includesAny(text, ["portfolio", "portafolio", "inversion", "inversiones", "acciones", "stock", "crypto", "mercado"])) {
    if (includesAny(text, ["precio", "precios", "actualiza"])) {
      actionIds.add("update_investment_prices");
    }
    if (includesAny(text, ["rebalance", "rebalanceo", "balance"])) {
      actionIds.add("portfolio_rebalance");
    }
    if (includesAny(text, ["oportunidad", "oportunidades", "alerta", "mercado"])) {
      actionIds.add("portfolio_opportunities");
    }
    if (actionIds.size === 0 || includesAny(text, ["resumen", "estado", "cuanto", "total"])) {
      actionIds.add("portfolio_summary");
    }
  }

  if (includesAny(text, ["tarea", "tareas", "agenda", "pendiente", "pendientes", "hoy", "semana"])) {
    if (includesAny(text, ["atrasada", "atrasadas", "vencida", "vencidas"])) {
      actionIds.add("tasks_overdue");
    } else if (includesAny(text, ["semana", "weekly", "proximos 7"])) {
      actionIds.add("tasks_week_summary");
    } else {
      actionIds.add("tasks_today_summary");
    }
  }

  if (includesAny(text, ["briefing", "brief", "buenos dias", "reporte diario", "resumen diario"])) {
    actionIds.add("morning_briefing");
  }

  if (includesAny(text, ["cierre del dia", "noche", "revision del dia", "evening"])) {
    actionIds.add("evening_review");
  }

  if (includesAny(text, ["editar video", "edicion de video", "video radio"])) {
    actionIds.add("create_video_edit_task");
  }

  return Array.from(actionIds);
}

async function handleTelegramWorkRequest(userId: string, message: string): Promise<string | null> {
  const developerAutopilotHandoff = await createDeveloperAutopilotHandoff(userId, message, "telegram");
  if (developerAutopilotHandoff.status !== "invalid_request") {
    return developerAutopilotHandoff.message;
  }

  const actionIds = routeTelegramWorkRequest(message);
  if (actionIds.length === 0) return null;

  const results = await executeMultipleActions(actionIds, userId);
  const lines = results.map((result, index) => {
    const status = result.success ? "✅" : "⚠️";
    return `${status} ${actionIds[index]}: ${telegramPlain(result.message)}`;
  });

  return [
    "Ya puse a trabajar los agentes:",
    "",
    ...lines,
    "",
    "Si quieres que haga algo más específico, dime el área y el objetivo. Ejemplo: “Radio, busca slots vacíos y dime a quién falta confirmar”.",
  ].join("\n");
}

async function buildTelegramHealthStatus(userId: string): Promise<string> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const config = await storage.getTelegramConfig(userId);
  const webhook = botToken ? await getTelegramWebhookStatus().catch(() => null) : null;
  const expectedWebhookUrl = resolveTelegramWebhookUrl();
  const scheduler = getReminderSchedulerConfig();
  const pendingActions = (await storage.getPendingActions(userId))
    .filter((action) => action.status === "pending" || action.status === "draft" || action.status === "edited");

  const tokenReady = hasRealValue(botToken);
  const aiReady = hasRealValue(process.env.AI_INTEGRATIONS_GEMINI_API_KEY);
  const chatReady = Boolean(config?.chatId);
  const notificationsReady = Boolean(config?.enabled);
  const webhookReady = Boolean(webhook?.url);
  const webhookMatchesExpected = Boolean(expectedWebhookUrl && webhook?.url === expectedWebhookUrl);
  const readyForBriefs = tokenReady && chatReady && notificationsReady;
  const readyForChat = readyForBriefs && webhookReady && aiReady;

  const flag = (ok: boolean) => ok ? "OK" : "PENDIENTE";

  return [
    "Estado Telegram CEO",
    "",
    `Brief mañanero: ${flag(readyForBriefs)}`,
    `Chat por Telegram: ${flag(readyForChat)}`,
    `Bot token: ${flag(tokenReady)}`,
    `IA configurada: ${flag(aiReady)}`,
    `Chat configurado: ${flag(chatReady)}`,
    `Notificaciones: ${notificationsReady ? "OK activas" : "PENDIENTE desactivadas"}`,
    `Webhook: ${flag(webhookReady)}`,
    `Webhook URL: ${webhook?.url || "sin configurar"}`,
    `URL esperada: ${expectedWebhookUrl || "sin PUBLIC_APP_URL/TELEGRAM_WEBHOOK_URL"}`,
    `Webhook coincide: ${flag(webhookMatchesExpected)}`,
    `Secret webhook: ${flag(hasStrongSecret(process.env.TELEGRAM_WEBHOOK_SECRET, 16))}`,
    `Updates pendientes: ${webhook?.pending_update_count || 0}`,
    `Ultimo error webhook: ${webhook?.last_error_message || "ninguno"}`,
    `Scheduler: ${scheduler.timezone}, brief ${String(scheduler.ceoBriefHour).padStart(2, "0")}:${String(scheduler.ceoBriefMinute).padStart(2, "0")}`,
    `Aprobaciones pendientes: ${pendingActions.length}`,
  ].join("\n");
}

async function buildTelegramCeoReadiness(userId: string): Promise<string> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const config = await storage.getTelegramConfig(userId);
  const webhook = botToken ? await getTelegramWebhookStatus().catch(() => null) : null;
  const expectedWebhookUrl = resolveTelegramWebhookUrl();
  const scheduler = getReminderSchedulerConfig();
  const report = buildCeoReadinessReport({
    auth: {
      userId,
      devFallbackAllowed: allowsDevUserFallback(),
      usingDevFallback: userId === DEFAULT_DEV_USER_ID && !hasRealValue(process.env.DEFAULT_USER_ID),
      defaultUserConfigured: hasRealValue(process.env.DEFAULT_USER_ID),
    },
    assistant: {
      aiConfigured: hasRealValue(process.env.AI_INTEGRATIONS_GEMINI_API_KEY),
    },
    telegram: {
      tokenConfigured: hasRealValue(botToken),
      chatConfigured: Boolean(config?.chatId),
      enabled: Boolean(config?.enabled),
      webhookUrlConfigured: Boolean(expectedWebhookUrl),
      webhookRegistered: Boolean(webhook?.url),
      webhookMatchesExpected: Boolean(expectedWebhookUrl && webhook?.url === expectedWebhookUrl),
      webhookSecretConfigured: hasStrongSecret(process.env.TELEGRAM_WEBHOOK_SECRET, 16),
      lastWebhookError: webhook?.last_error_message || null,
    },
    scheduler: {
      timezone: scheduler.timezone,
      ceoBriefHour: scheduler.ceoBriefHour,
      ceoBriefMinute: scheduler.ceoBriefMinute,
    },
  });

  const icon = report.status === "ready" ? "OK" : report.status === "warning" ? "WARNING" : "BLOCKED";

  return [
    "CEO Assistant Readiness",
    "",
    `Estado: ${icon} ${report.status.toUpperCase()}`,
    "",
    ...report.checks.map((check) => [
      `${check.status.toUpperCase()} - ${check.label}`,
      check.detail,
    ].join("\n")),
  ].join("\n\n");
}

async function processAssistantResponse(userId: string, response: string): Promise<string[]> {
  const actions: string[] = [];
  
  const createTaskRegex = /\[CREAR_TAREA:\s*(\{[^}]+\})\]/g;
  let taskMatch;
  while ((taskMatch = createTaskRegex.exec(response)) !== null) {
    try {
      const taskData = JSON.parse(taskMatch[1]);
      const task = await storage.createTask(userId, {
        title: taskData.title,
        date: new Date(taskData.date),
        priority: taskData.priority || "normal",
        completed: false,
        type: "regular",
      });
      await writeAuditLog({
        userId,
        actorType: "assistant",
        actorId: "telegram-assistant",
        origin: "telegram",
        actionType: "task.create",
        resourceType: "task",
        resourceId: task.id,
        metadata: taskData,
        status: "succeeded",
        executionMode: "user_requested",
      });
      actions.push(`✅ Tarea creada: ${taskData.title}`);
    } catch (e) {
      console.error("Error creating task from Telegram:", e);
    }
  }

  const createFollowUpRegex = /\[CREAR_FOLLOWUP:\s*(\{[^}]+\})\]/g;
  let followUpMatch;
  while ((followUpMatch = createFollowUpRegex.exec(response)) !== null) {
    try {
      const followUpData = JSON.parse(followUpMatch[1]);
      const date = followUpData.date ? new Date(followUpData.date) : new Date(Date.now() + 24 * 60 * 60 * 1000);
      const description = [
        `Owner: ${followUpData.person}`,
        followUpData.channel ? `Channel: ${followUpData.channel}` : null,
        followUpData.notes ? `Notes: ${followUpData.notes}` : null,
      ].filter(Boolean).join("\n");
      const task = await storage.createTask(userId, {
        title: `Follow-up: ${followUpData.person} - ${followUpData.topic}`,
        description,
        date,
        priority: followUpData.priority || "normal",
        completed: false,
        type: "follow_up",
      });
      await writeAuditLog({
        userId,
        actorType: "assistant",
        actorId: "telegram-assistant",
        origin: "telegram",
        actionType: "follow_up.create",
        resourceType: "task",
        resourceId: task.id,
        metadata: followUpData,
        status: "succeeded",
        executionMode: "user_requested",
      });
      actions.push(`📌 Follow-up creado: ${followUpData.person} - ${followUpData.topic}`);
    } catch (e) {
      console.error("Error creating follow-up from Telegram:", e);
    }
  }

  const saveDecisionRegex = /\[GUARDAR_DECISION:\s*(\{[^}]+\})\]/g;
  let decisionMatch;
  while ((decisionMatch = saveDecisionRegex.exec(response)) !== null) {
    try {
      const decisionData = JSON.parse(decisionMatch[1]);
      const value = decisionData.context ? `${decisionData.decision}\nContext: ${decisionData.context}` : decisionData.decision;
      const decision = await storage.saveUserProfileData(userId, {
        userId,
        category: "decision",
        key: decisionData.title,
        value,
        confidence: "confirmed",
        source: "telegram",
      });
      await writeAuditLog({
        userId,
        actorType: "assistant",
        actorId: "telegram-assistant",
        origin: "telegram",
        actionType: "decision.save",
        resourceType: "user_profile_data",
        resourceId: decision.id,
        metadata: decisionData,
        status: "succeeded",
        executionMode: "user_requested",
      });
      actions.push(`🧭 Decisión guardada: ${decisionData.title}`);
    } catch (e) {
      console.error("Error saving decision from Telegram:", e);
    }
  }

  const saveInfoRegex = /\[GUARDAR_INFO:\s*(\{[^}]+\})\]/g;
  let infoMatch;
  while ((infoMatch = saveInfoRegex.exec(response)) !== null) {
    try {
      const infoData = JSON.parse(infoMatch[1]);
      await storage.saveUserProfileData(userId, {
        userId,
        category: infoData.category,
        key: infoData.key,
        value: infoData.value,
      });
      await writeAuditLog({
        userId,
        actorType: "assistant",
        actorId: "telegram-assistant",
        origin: "telegram",
        actionType: "memory.save",
        resourceType: "user_profile_data",
        metadata: infoData,
        status: "succeeded",
        executionMode: "user_requested",
      });
      actions.push(`💾 Info guardada: ${infoData.key}`);
    } catch (e) {
      console.error("Error saving info from Telegram:", e);
    }
  }

  const savePersonRegex = /\[GUARDAR_PERSONA:\s*(\{[^}]+\})\]/g;
  let personMatch;
  while ((personMatch = savePersonRegex.exec(response)) !== null) {
    try {
      const personData = JSON.parse(personMatch[1]);
      const value = [
        personData.role ? `Role: ${personData.role}` : null,
        personData.company ? `Company: ${personData.company}` : null,
        personData.notes ? `Notes: ${personData.notes}` : null,
      ].filter(Boolean).join("\n") || "Key person";
      const person = await storage.saveUserProfileData(userId, {
        userId,
        category: "person",
        key: personData.name,
        value,
        confidence: "confirmed",
        source: "telegram",
      });
      await writeAuditLog({
        userId,
        actorType: "assistant",
        actorId: "telegram-assistant",
        origin: "telegram",
        actionType: "person.save",
        resourceType: "user_profile_data",
        resourceId: person.id,
        metadata: personData,
        status: "succeeded",
        executionMode: "user_requested",
      });
      actions.push(`👤 Persona guardada: ${personData.name}`);
    } catch (e) {
      console.error("Error saving person from Telegram:", e);
    }
  }

  const saveCommitmentRegex = /\[GUARDAR_COMPROMISO:\s*(\{[^}]+\})\]/g;
  let commitmentMatch;
  while ((commitmentMatch = saveCommitmentRegex.exec(response)) !== null) {
    try {
      const commitmentData = JSON.parse(commitmentMatch[1]);
      const value = [
        commitmentData.commitment,
        commitmentData.dueAt ? `Due: ${commitmentData.dueAt}` : null,
        commitmentData.context ? `Context: ${commitmentData.context}` : null,
      ].filter(Boolean).join("\n");
      const commitment = await storage.saveUserProfileData(userId, {
        userId,
        category: "commitment",
        key: commitmentData.owner,
        value,
        confidence: "confirmed",
        source: "telegram",
      });
      await writeAuditLog({
        userId,
        actorType: "assistant",
        actorId: "telegram-assistant",
        origin: "telegram",
        actionType: "commitment.save",
        resourceType: "user_profile_data",
        resourceId: commitment.id,
        metadata: commitmentData,
        status: "succeeded",
        executionMode: "user_requested",
      });
      actions.push(`🤝 Compromiso guardado: ${commitmentData.owner}`);
    } catch (e) {
      console.error("Error saving commitment from Telegram:", e);
    }
  }

  const communicationDraftRegex = /\[CREAR_BORRADOR_COMUNICACION:\s*(\{[^}]+\})\]/g;
  let communicationDraftMatch;
  while ((communicationDraftMatch = communicationDraftRegex.exec(response)) !== null) {
    try {
      const draftData = JSON.parse(communicationDraftMatch[1]);
      const pendingAction = await createPendingActionForApproval({
        userId,
        actorType: "assistant",
        actorId: "telegram-assistant",
        origin: "telegram",
        executionMode: "user_requested",
        actionType: "communications.send",
        resourceType: "communication_draft",
        title: `Borrador para ${draftData.recipient}`,
        description: `Enviar por ${draftData.channel}${draftData.subject ? `: ${draftData.subject}` : ""}`,
        input: draftData,
        proposedChanges: {
          recipient: draftData.recipient,
          channel: draftData.channel,
          subject: draftData.subject,
          message: draftData.message,
        },
      });
      actions.push(`💬 Borrador pendiente de aprobación: ${pendingAction.id}`);
    } catch (e) {
      console.error("Error creating communication draft from Telegram:", e);
    }
  }

  const metricoolAutomationRegex = /\[METRICOOL_AUTOMATION:\s*(\{[^}]+\})\]/g;
  let metricoolAutomationMatch;
  while ((metricoolAutomationMatch = metricoolAutomationRegex.exec(response)) !== null) {
    try {
      const metricoolData = sanitizeMetricoolAutomationInput(JSON.parse(metricoolAutomationMatch[1]));
      const pendingAction = await createPendingActionForApproval({
        userId,
        actorType: "assistant",
        actorId: "telegram-assistant",
        origin: "telegram",
        executionMode: "user_requested",
        actionType: "marketing.metricool_automation",
        resourceType: "metricool_execution_queue",
        title: metricoolData.publishMode === "auto_after_connection" ? "Preparar Metricool auto publish" : "Preparar cola Metricool",
        description: buildMetricoolPendingDescription(metricoolData),
        input: metricoolData,
        proposedChanges: metricoolData,
      });
      actions.push(`Metricool pendiente de aprobacion: ${pendingAction.id}`);
    } catch (e) {
      actions.push(`No pude preparar Metricool: ${e instanceof Error ? e.message : "error desconocido"}`);
    }
  }

  const radioYoutubeRegex = /\[RADIO_YOUTUBE_CLIPS:\s*(\{[^}]+\})\]/g;
  let radioYoutubeMatch;
  while ((radioYoutubeMatch = radioYoutubeRegex.exec(response)) !== null) {
    try {
      const radioYoutubeData = JSON.parse(radioYoutubeMatch[1]);
      const result = await executeDirectRadioYoutubeCommand({
        youtubeUrl: radioYoutubeData.youtubeUrl,
        driveFolderPath: Array.isArray(radioYoutubeData.driveFolderPath) ? radioYoutubeData.driveFolderPath : [],
        driveParentFolderId: typeof radioYoutubeData.driveParentFolderId === "string" ? radioYoutubeData.driveParentFolderId : undefined,
        createFolderIfMissing: Boolean(radioYoutubeData.createFolderIfMissing),
        driveFolderPathFromYoutubeTitle: Boolean(radioYoutubeData.driveFolderPathFromYoutubeTitle),
        djName: radioYoutubeData.djName,
        musicUrl: radioYoutubeData.musicUrl,
        instagramClipCount: Number.isFinite(Number(radioYoutubeData.instagramClipCount)) ? Number(radioYoutubeData.instagramClipCount) : undefined,
        tiktokClipCount: Number.isFinite(Number(radioYoutubeData.tiktokClipCount)) ? Number(radioYoutubeData.tiktokClipCount) : undefined,
        deleteSourceAfterSuccess: radioYoutubeData.deleteSourceAfterSuccess !== false,
        content: "Voy a procesar ese YouTube para radio.",
        command: radioYoutubeMatch[0],
      }, userId);
      actions.push(formatRadioYoutubeResult(result));
    } catch (e) {
      actions.push(`No pude procesar el YouTube de radio: ${e instanceof Error ? e.message : "error desconocido"}`);
    }
  }

  const radioDriveVideoRegex = /\[RADIO_DRIVE_VIDEO_CLIPS:\s*(\{[^}]+\})\]/g;
  let radioDriveVideoMatch;
  while ((radioDriveVideoMatch = radioDriveVideoRegex.exec(response)) !== null) {
    try {
      const radioDriveVideoData = JSON.parse(radioDriveVideoMatch[1]);
      const result = await executeDirectRadioDriveVideoCommand({
        sourceDriveFileId: radioDriveVideoData.sourceDriveFileId,
        sourceDriveUrl: radioDriveVideoData.sourceDriveUrl,
        driveFolderPath: Array.isArray(radioDriveVideoData.driveFolderPath) ? radioDriveVideoData.driveFolderPath : [],
        driveParentFolderId: typeof radioDriveVideoData.driveParentFolderId === "string" ? radioDriveVideoData.driveParentFolderId : undefined,
        createFolderIfMissing: Boolean(radioDriveVideoData.createFolderIfMissing),
        djName: radioDriveVideoData.djName,
        musicUrl: radioDriveVideoData.musicUrl,
        instagramClipCount: Number.isFinite(Number(radioDriveVideoData.instagramClipCount)) ? Number(radioDriveVideoData.instagramClipCount) : undefined,
        tiktokClipCount: Number.isFinite(Number(radioDriveVideoData.tiktokClipCount)) ? Number(radioDriveVideoData.tiktokClipCount) : undefined,
        deleteSourceAfterSuccess: radioDriveVideoData.deleteSourceAfterSuccess !== false,
        content: "Voy a procesar ese MP4 de Drive para radio.",
        command: radioDriveVideoMatch[0],
      }, userId);
      actions.push(formatRadioDriveVideoResult(result));
    } catch (e) {
      actions.push(`No pude procesar el MP4 de Drive: ${e instanceof Error ? e.message : "error desconocido"}`);
    }
  }

  const googleDriveCreateFolderRegex = /\[GOOGLE_DRIVE_CREATE_FOLDER:\s*(\{[^}]+\})\]/g;
  let googleDriveCreateFolderMatch;
  while ((googleDriveCreateFolderMatch = googleDriveCreateFolderRegex.exec(response)) !== null) {
    try {
      const driveData = JSON.parse(googleDriveCreateFolderMatch[1]);
      const result = await createGoogleDriveFolderPath({
        userId,
        driveFolderPath: driveData.driveFolderPath,
        origin: "telegram",
      });
      actions.push(formatGoogleDriveFolderCreateResult(result));
    } catch (e) {
      actions.push(`No pude crear la carpeta de Google Drive: ${e instanceof Error ? e.message : "error desconocido"}`);
    }
  }

  const reminderRegex = /\[CREAR_RECORDATORIO:\s*(\{[^}]+\})\]/g;
  let reminderMatch;
  while ((reminderMatch = reminderRegex.exec(response)) !== null) {
    try {
      const reminderData = JSON.parse(reminderMatch[1]);
      const reminder = await storage.createScheduledReminder(userId, {
        message: reminderData.message,
        hour: parseInt(reminderData.hour),
        minute: parseInt(reminderData.minute || 0),
        daysOfWeek: reminderData.daysOfWeek || null,
        isActive: true,
      });
      await writeAuditLog({
        userId,
        actorType: "assistant",
        actorId: "telegram-assistant",
        origin: "telegram",
        actionType: "reminder.create",
        resourceType: "scheduled_reminder",
        resourceId: reminder.id,
        metadata: reminderData,
        status: "succeeded",
        executionMode: "user_requested",
      });
      actions.push(`⏰ Recordatorio creado: ${reminderData.message}`);
    } catch (e) {
      console.error("Error creating reminder from Telegram:", e);
    }
  }

  // Process MODIFICAR_RADIO commands
  const modifyRadioRegex = /\[MODIFICAR_RADIO:\s*(\{[^}]+\})\]/g;
  let radioMatch;
  while ((radioMatch = modifyRadioRegex.exec(response)) !== null) {
    try {
      const radioData = JSON.parse(radioMatch[1]);
      if (radioData.eventId && radioData.description) {
        const pendingAction = await createPendingActionForApproval({
          userId,
          actorType: "assistant",
          actorId: "telegram-assistant",
          origin: "telegram",
          executionMode: "user_requested",
          actionType: "calendar.modify_radio",
          resourceType: "calendar_event",
          resourceId: radioData.eventId,
          title: "Modificar evento de Radio",
          description: "Telegram Assistant quiere actualizar DJs/slots en Google Calendar.",
          input: radioData,
          proposedChanges: { description: radioData.description },
        });
        actions.push(`🛡️ Radio pendiente de aprobación: ${pendingAction.id}`);
      }
    } catch (e) {
      console.error("Error modifying radio from Telegram:", e);
    }
  }

  // Process AGREGAR_INVERSION commands
  const addInvestmentRegex = /\[AGREGAR_INVERSION:\s*(\{[^}]+\})\]/g;
  let addInvMatch;
  while ((addInvMatch = addInvestmentRegex.exec(response)) !== null) {
    try {
      const invData = JSON.parse(addInvMatch[1]);
      const validTypes = ["stock", "etf", "crypto", "bond", "fund"];
      const type = validTypes.includes(invData.type) ? invData.type : "stock";
      const pendingAction = await createPendingActionForApproval({
        userId,
        actorType: "assistant",
        actorId: "telegram-assistant",
        origin: "telegram",
        executionMode: "user_requested",
        actionType: "finance.create_investment",
        resourceType: "investment",
        title: `Agregar inversión: ${invData.symbol.toUpperCase()}`,
        description: "Telegram Assistant quiere agregar una inversión al portafolio.",
        input: {
          symbol: invData.symbol.toUpperCase(),
          name: invData.name,
          type,
          quantity: String(invData.quantity),
          avgBuyPrice: String(invData.avgBuyPrice),
          currency: "USD",
        },
        proposedChanges: invData,
      });
      actions.push(`🛡️ Inversión pendiente de aprobación: ${pendingAction.id}`);
    } catch (e) {
      console.error("Error adding investment from Telegram:", e);
    }
  }

  // Process ACTUALIZAR_INVERSION commands
  const updateInvestmentRegex = /\[ACTUALIZAR_INVERSION:\s*(\{[^}]+\})\]/g;
  let updateInvMatch;
  const investments = await storage.getInvestments(userId);
  while ((updateInvMatch = updateInvestmentRegex.exec(response)) !== null) {
    try {
      const invData = JSON.parse(updateInvMatch[1]);
      const existing = investments.find(i => i.symbol.toUpperCase() === invData.symbol.toUpperCase());
      if (existing) {
        const updates: any = {};
        if (invData.quantity) updates.quantity = String(invData.quantity);
        if (invData.avgBuyPrice) updates.avgBuyPrice = String(invData.avgBuyPrice);
        const pendingAction = await createPendingActionForApproval({
          userId,
          actorType: "assistant",
          actorId: "telegram-assistant",
          origin: "telegram",
          executionMode: "user_requested",
          actionType: "finance.update_investment",
          resourceType: "investment",
          resourceId: existing.id,
          title: `Actualizar inversión: ${invData.symbol.toUpperCase()}`,
          description: "Telegram Assistant quiere modificar datos del portafolio.",
          input: { symbol: invData.symbol.toUpperCase(), ...updates },
          proposedChanges: updates,
        });
        actions.push(`🛡️ Actualización pendiente de aprobación: ${pendingAction.id}`);
      }
    } catch (e) {
      console.error("Error updating investment from Telegram:", e);
    }
  }

  // Process ELIMINAR_INVERSION commands
  const deleteInvestmentRegex = /\[ELIMINAR_INVERSION:\s*(\{[^}]+\})\]/g;
  let deleteInvMatch;
  while ((deleteInvMatch = deleteInvestmentRegex.exec(response)) !== null) {
    try {
      const invData = JSON.parse(deleteInvMatch[1]);
      const existing = investments.find(i => i.symbol.toUpperCase() === invData.symbol.toUpperCase());
      if (existing) {
        const pendingAction = await createPendingActionForApproval({
          userId,
          actorType: "assistant",
          actorId: "telegram-assistant",
          origin: "telegram",
          executionMode: "user_requested",
          actionType: "finance.delete_investment",
          resourceType: "investment",
          resourceId: existing.id,
          title: `Eliminar inversión: ${invData.symbol.toUpperCase()}`,
          description: "Telegram Assistant quiere eliminar una inversión del portafolio.",
          input: { symbol: invData.symbol.toUpperCase() },
          proposedChanges: { delete: true, symbol: invData.symbol.toUpperCase() },
        });
        actions.push(`🛡️ Eliminación pendiente de aprobación: ${pendingAction.id}`);
      }
    } catch (e) {
      console.error("Error deleting investment from Telegram:", e);
    }
  }

  return actions;
}

function cleanResponseForTelegram(response: string): string {
  let clean = response
    .replace(/\[CREAR_TAREA:[^\]]+\]/g, "")
    .replace(/\[CREAR_FOLLOWUP:[^\]]+\]/g, "")
    .replace(/\[GUARDAR_DECISION:[^\]]+\]/g, "")
    .replace(/\[GUARDAR_PERSONA:[^\]]+\]/g, "")
    .replace(/\[GUARDAR_COMPROMISO:[^\]]+\]/g, "")
    .replace(/\[CREAR_BORRADOR_COMUNICACION:[^\]]+\]/g, "")
    .replace(/\[METRICOOL_AUTOMATION:[^\]]+\]/g, "")
    .replace(/\[GUARDAR_INFO:[^\]]+\]/g, "")
    .replace(/\[CREAR_RECORDATORIO:[^\]]+\]/g, "")
    .replace(/\[MODIFICAR_RADIO:[^\]]+\]/g, "")
    .replace(/\[CREAR_EVENTO_GOOGLE:[^\]]+\]/g, "")
    .replace(/\[AGREGAR_INVERSION:[^\]]+\]/g, "")
    .replace(/\[ACTUALIZAR_INVERSION:[^\]]+\]/g, "")
    .replace(/\[ELIMINAR_INVERSION:[^\]]+\]/g, "")
    .replace(/\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clean;
}

export async function handleTelegramMessageWithDeps(
  update: TelegramUpdate,
  deps: TelegramMessageHandlerDeps,
): Promise<void> {
  const hasText = !!update.message?.text;
  const hasPhoto = !!update.message?.photo && update.message.photo.length > 0;
  const hasCaption = !!update.message?.caption;
  
  if (!hasText && !hasPhoto) return;
  
  const chatId = update.message!.chat.id.toString();
  const userMessage = update.message?.text || update.message?.caption || "";
  const botToken = deps.getBotToken();
  
  if (!hasRealValue(botToken)) {
    console.error("[Telegram Chat] No bot token configured");
    return;
  }

  let config = await deps.getTelegramConfigByChatId(chatId);
  if (!config) {
    await deps.sendPlainMessage(
      botToken,
      chatId,
      [
        "Recibí tu mensaje, pero este chat de Telegram todavía no está vinculado a un usuario del asistente.",
        "",
        "Para conectarlo, abre el panel web o ejecuta:",
        "`npm run telegram:configure -- --user-id=<real-user-id> --chat-id=" + chatId + " --execute`",
      ].join("\n")
    );
    return;
  }
  if (!config.enabled) {
    config = await deps.saveTelegramConfig(config.userId, chatId);
  }
  const userId = config.userId;

  try {
    if (userMessage) {
      await deps.saveConversationMessage(userId, "user", userMessage);
    } else if (hasPhoto) {
      await deps.saveConversationMessage(userId, "user", "[Imagen enviada por Telegram]");
    }

    const controlResponse = userMessage ? await deps.handleControlCommand(userId, userMessage) : null;
    if (controlResponse) {
      await deps.sendPlainMessageChunks(botToken, chatId, controlResponse);
      await deps.saveConversationMessage(userId, "assistant", controlResponse);
      return;
    }

    const workResponse = userMessage ? await deps.handleWorkRequest(userId, userMessage) : null;
    if (workResponse) {
      await deps.sendPlainMessageChunks(botToken, chatId, workResponse);
      await deps.saveConversationMessage(userId, "assistant", workResponse);
      return;
    }

    if (!hasRealValue(deps.getAiKey())) {
      const missingAiMessage = "❌ Error: API de IA no configurada.";
      await deps.sendPlainMessage(botToken, chatId, missingAiMessage);
      await deps.saveConversationMessage(userId, "assistant", missingAiMessage);
      return;
    }

    await deps.sendPlainMessage(botToken, chatId, hasPhoto ? "📷 Analizando imagen..." : "💭 Pensando...");

    // Download photo if present
    let imageData: { base64: string; mimeType: string } | null = null;
    if (hasPhoto && update.message?.photo) {
      const photos = update.message.photo;
      const largestPhoto = photos[photos.length - 1]; // Get highest resolution
      imageData = await downloadTelegramPhoto(botToken, largestPhoto.file_id);
    }

    const historyLimit = getAiConversationHistoryLimit();
    const aiCostPolicyContext = buildAiCostPolicyContext("telegram");
    const [calendarContext, userProfile, portfolioContext, tasksContext, ceoContext, conversationHistory, claudeSkillContext] = await Promise.all([
      getCalendarContext(),
      getUserProfileContext(userId),
      getPortfolioContext(userId),
      getTasksContext(userId),
      generateTelegramAssistantContext(userId),
      getCeoConversationHistory(userId, historyLimit, userMessage || (hasPhoto ? "[Imagen enviada por Telegram]" : undefined)),
      buildClaudeSkillContext(userMessage),
    ]);

    console.log("[Telegram Chat] Calendar context length:", calendarContext.length);
    console.log("[Telegram Chat] Tasks context length:", tasksContext.length);
    console.log("[Telegram Chat] Has image:", !!imageData);

    const systemPrompt = getTelegramSystemPrompt();
    const contextPrompt = `${systemPrompt}

=== DATOS DEL USUARIO ===

${calendarContext}

${ceoContext}

${aiCostPolicyContext}

${claudeSkillContext}

${tasksContext}

${userProfile}

${portfolioContext}

HISTORIAL RECIENTE COMPARTIDO WEB/TELEGRAM:
${conversationHistory}

=== FIN DE DATOS ===`;

    // Build content parts for Gemini
    const parts: Part[] = [];
    
    // Add image if present
    if (imageData) {
      parts.push({
        inlineData: {
          mimeType: imageData.mimeType,
          data: imageData.base64,
        },
      });
      
      // Add default message if no text was provided with the image
      const imageMessage = userMessage || "Analiza esta imagen de mi broker/cartera y extrae la información de mis inversiones. Si encuentras acciones, ETFs o criptomonedas, agrégalas a mi portafolio.";
      parts.push({ text: `${contextPrompt}\n\nUsuario dice: ${imageMessage}` });
    } else {
      parts.push({ text: `${contextPrompt}\n\nUsuario dice: ${userMessage}` });
    }

    const geminiClient = await getGeminiClient();
    const result = await geminiClient.models.generateContent({
      model: getGeminiChatModel({ hasImage: !!imageData }),
      contents: [{ role: "user", parts }],
    });
    const responseText = result.text || "";

    const actions = await processAssistantResponse(userId, responseText);
    const cleanResponse = cleanResponseForTelegram(responseText);
    let responseToSend = cleanResponse;
    
    if (actions.length > 0) {
      responseToSend += "\n\n" + actions.join("\n");
    }

    if (!responseToSend.trim()) {
      responseToSend = "No pude generar una respuesta útil esta vez. Intenta reformularlo en una frase más concreta.";
    }

    await deps.sendPlainMessageChunks(botToken, chatId, responseToSend);
    await deps.saveConversationMessage(userId, "assistant", responseToSend);
  } catch (error) {
    console.error("[Telegram Chat] Error processing message:", error);
    const errorMessage = "❌ Error al procesar el mensaje. Intenta de nuevo.";
    await deps.sendPlainMessage(botToken, chatId, errorMessage);
    await deps.saveConversationMessage(userId, "assistant", errorMessage);
  }
}

export async function handleTelegramMessage(update: TelegramUpdate): Promise<void> {
  return handleTelegramMessageWithDeps(update, defaultTelegramMessageHandlerDeps);
}

export async function setupTelegramWebhook(): Promise<{ success: boolean; message: string }> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!hasRealValue(botToken)) {
    return { success: false, message: "No bot token configured" };
  }

  const webhookUrl = resolveTelegramWebhookUrl();

  if (!webhookUrl) {
    return { success: false, message: "Could not determine webhook URL" };
  }

  if (!isHttpsUrl(webhookUrl)) {
    return { success: false, message: "Webhook URL must be a real HTTPS URL" };
  }

  if (!hasStrongSecret(process.env.TELEGRAM_WEBHOOK_SECRET, 16)) {
    return { success: false, message: "TELEGRAM_WEBHOOK_SECRET must be a real random secret with at least 16 characters" };
  }

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const success = await setTelegramWebhook(botToken, webhookUrl, webhookSecret);
  return {
    success,
    message: success
      ? `Webhook configured: ${webhookUrl}${webhookSecret ? " with secret token" : ""}`
      : "Failed to set webhook"
  };
}

export async function getTelegramWebhookStatus(): Promise<any> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!hasRealValue(botToken)) return null;
  return await getWebhookInfo(botToken);
}
