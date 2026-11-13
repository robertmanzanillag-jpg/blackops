import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { format, startOfWeek, endOfWeek, addWeeks, startOfMonth, endOfMonth, addMonths, differenceInHours } from "date-fns";
import { es } from "date-fns/locale";
import { getCurrentUserId } from "./user-context";
import { createPendingActionForApproval, writeAuditLog } from "./trust-policy";
import { executeApprovedPendingAction } from "./trust-executor";
import { generateTelegramAssistantContext } from "./ceo-briefing";
import { getCeoConversationHistory, saveCeoConversationMessage } from "./ceo-conversation-history";
import { formatBlackRoomLinkPerformance, getBlackRoomLinkPerformance } from "./blackroom-links";
import { PromoVideoSourceError, runPromoVideoAutoDaily } from "./promo-video-agent";
import { buildDirectGoogleDriveFolderCommand, createGoogleDriveFolderPath, formatGoogleDriveFolderCreateResult } from "./google-drive-folder-command";
import { buildDirectRadioDriveVideoCommand, buildDirectRadioYoutubeCommand, directRadioDriveVideoCommandNeedsDriveFolder, directRadioYoutubeCommandNeedsDriveFolder, executeDirectRadioDriveVideoCommand, executeDirectRadioYoutubeCommand, extractDriveFolderPathFromMessage, formatRadioDriveVideoResult, formatRadioYoutubeResult } from "./radio-youtube-command";
import { buildDirectMetricoolCommand, buildMetricoolPendingDescription, sanitizeMetricoolAutomationInput } from "./metricool-chat-actions";
import { executeBlackRoomChatMessage, looksLikeBlackRoomAssistantRequest } from "./blackroom-chat-service";
import { isConfiguredSingleUserOwner } from "./single-user-owner";
import { buildClaudeSkillContext } from "./claude-skill-bridge";
import { createDeveloperAutopilotHandoff } from "./developer-autopilot";
import { buildAiCostPolicyContext, getAiConversationHistoryLimit, getOpenAiMaxCompletionTokens } from "./ai-cost-policy";
import { estimateOpenAiAudioCostUsd, estimateTokenApiCostUsd, recordAiApiCostEvent } from "./ai-cost-notifications";
import { shouldUseCheapScoutForWebChat } from "./ai-router";
import { getGeminiChatModel, getGeminiClient } from "./gemini-client";
import type { PendingAction } from "@shared/schema";
import { getOpenAIClient, OPENAI_ASSISTANT_MODEL, OPENAI_TRANSCRIPTION_MODEL } from "./openai-client";
import { toFile } from "openai";
import type { ChatCompletionContentPart, ChatCompletionMessageParam } from "openai/resources/chat/completions";

const ASSISTANT_TIMEZONE = "America/New_York";
const CHEAP_SCOUT_CACHE_TTL_MS = 10 * 60 * 1000;
const CHEAP_SCOUT_CACHE_MAX_ENTRIES = 200;
const RADIO_EDIT_ESTIMATED_COST_TEXT = "Gasto estimado de esta corrida: $0.00 USD.";
const RADIO_DRIVE_VIDEO_STATUS_MESSAGE = `Estoy trabajando: preparo Drive, descargo el MP4 fuente, creo los clips y luego los subo a tu carpeta. ${RADIO_EDIT_ESTIMATED_COST_TEXT}`;
const RADIO_YOUTUBE_STATUS_MESSAGE = `Estoy trabajando: descargo el YouTube, creo los clips, los subo a Drive y borro el video largo local. ${RADIO_EDIT_ESTIMATED_COST_TEXT}`;
const cheapScoutResponseCache = new Map<string, { response: string; expiresAt: number }>();

export { buildDirectMetricoolCommand };

function estimateTokensFromText(text: string): number {
  return Math.ceil(Math.max(0, text.length) / 4);
}

function formatAiApiCostPreview(provider: string, model: string, operation: string, estimatedCostUsd: number): string {
  return `Costo API aproximado antes de ejecutar: ${provider.toUpperCase()} ${model} para ${operation} puede salir hasta ~$${estimatedCostUsd.toFixed(4)} USD. Si ya lo aprobaste, sigo con la tarea.`;
}

function withRadioEditEstimatedCost(message: string): string {
  return /gasto estimado/i.test(message) ? message : `${message}\n${RADIO_EDIT_ESTIMATED_COST_TEXT}`;
}

function writeOwnerOnlySharedConnectorBlock(res: Response, connectorName: string): void {
  res.write(`data: ${JSON.stringify({
    content: `No puedo ejecutar ${connectorName} para este usuario porque usa conectores compartidos de producción. Solo el owner configurado puede correr esta acción.`,
    sharedConnectorBlocked: true,
  })}\n\n`);
}

function writeAssistantSse(res: Response, payload: Record<string, unknown>): void {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    // A disconnected browser should not stop long-running video work or history writes.
  }
}

function formatElapsedAssistantWork(startedAt: number): string {
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function writeAssistantStatus(res: Response, statusMessage: string, startedAt: number): void {
  const assistantStatus = `${statusMessage} Tiempo trabajando: ${formatElapsedAssistantWork(startedAt)}.`;
  writeAssistantSse(res, { assistantStatus });
}

function startAssistantStatusHeartbeat(res: Response, statusMessage: string): () => void {
  const startedAt = Date.now();
  writeAssistantStatus(res, statusMessage, startedAt);
  const timer = setInterval(() => {
    writeAssistantStatus(res, statusMessage, startedAt);
  }, 15_000);
  timer.unref?.();

  const stop = () => clearInterval(timer);
  res.once("close", stop);

  return () => {
    res.removeListener("close", stop);
    stop();
  };
}

function normalizeAssistantCacheText(message = ""): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAnyAssistantTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function isCacheableCheapScoutRequest(message?: string): boolean {
  const text = normalizeAssistantCacheText(message);
  if (!text) return false;
  const cacheableTerms = ["caption", "captions", "hook", "hooks", "hashtags", "ideas", "borrador", "draft", "clasifica", "duplicados"];
  const volatileTerms = ["hoy", "manana", "mañana", "ahora", "agenda", "calendario", "precio", "portfolio", "portafolio", "metricas", "analytics"];
  return includesAnyAssistantTerm(text, cacheableTerms) && !includesAnyAssistantTerm(text, volatileTerms);
}

function getCheapScoutCacheKey(userId: string, message?: string): string {
  return `${userId}:${normalizeAssistantCacheText(message).slice(0, 1200)}`;
}

function getCachedCheapScoutResponse(userId: string, message?: string): string | null {
  if (!isCacheableCheapScoutRequest(message)) return null;
  const key = getCheapScoutCacheKey(userId, message);
  const cached = cheapScoutResponseCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cheapScoutResponseCache.delete(key);
    return null;
  }
  return cached.response;
}

function setCachedCheapScoutResponse(userId: string, message: string | undefined, response: string): void {
  if (!isCacheableCheapScoutRequest(message) || !response.trim()) return;
  const now = Date.now();
  for (const [key, cached] of cheapScoutResponseCache) {
    if (cached.expiresAt <= now) cheapScoutResponseCache.delete(key);
  }
  while (cheapScoutResponseCache.size >= CHEAP_SCOUT_CACHE_MAX_ENTRIES) {
    const oldestKey = cheapScoutResponseCache.keys().next().value;
    if (!oldestKey) break;
    cheapScoutResponseCache.delete(oldestKey);
  }
  cheapScoutResponseCache.set(getCheapScoutCacheKey(userId, message), {
    response,
    expiresAt: now + CHEAP_SCOUT_CACHE_TTL_MS,
  });
}

type AssistantConversationHistoryMessage = {
  role: string;
  content: string;
};

function looksLikeShortDriveFolderReply(message?: string): boolean {
  if (!message) return false;
  const text = message.trim();
  if (text.length < 2 || text.length > 120) return false;
  if (/https?:\/\//i.test(text)) return false;
  if (/^(si|sí|ok|dale|hazlo|aprobado|confirmado|autorizado)$/i.test(text)) return false;
  return Boolean(extractDriveFolderPathFromMessage(`carpeta ${text}`)?.length);
}

export function buildRadioYoutubeContinuationMessage(
  message?: string,
  conversationHistory: AssistantConversationHistoryMessage[] = [],
): string | null {
  if (!looksLikeShortDriveFolderReply(message)) return null;

  const recentHistory = conversationHistory
    .filter((entry) => entry?.content && (entry.role === "assistant" || entry.role === "user"))
    .slice(-8);
  const lastAssistantMessage = [...recentHistory].reverse().find((entry) => entry.role === "assistant")?.content || "";
  if (!/carpeta de Google Drive|donde quieres que guarde|donde guardar/i.test(lastAssistantMessage)) return null;

  const previousUserMessage = [...recentHistory].reverse().find((entry) => {
    if (entry.role !== "user") return false;
    const youtubeCommand = buildDirectRadioYoutubeCommand(entry.content);
    const driveVideoCommand = buildDirectRadioDriveVideoCommand(entry.content);
    return Boolean(
      (youtubeCommand && (directRadioYoutubeCommandNeedsDriveFolder(youtubeCommand) || /carpeta de Google Drive/i.test(lastAssistantMessage))) ||
      (driveVideoCommand && (directRadioDriveVideoCommandNeedsDriveFolder(driveVideoCommand) || /carpeta de Google Drive/i.test(lastAssistantMessage))),
    );
  })?.content;

  if (!previousUserMessage) return null;
  return `${previousUserMessage.trim()} en la carpeta ${message?.trim()}`;
}

function buildCompactCheapScoutPrompt(input: {
  message?: string;
  aiCostPolicyContext: string;
  claudeSkillContext: string;
  userProfileContext: string;
  calendarContext: string;
  portfolioContext: string;
  ceoContext: string;
  sharedConversationHistory: string;
  modelRoute: { tier: string; provider: string; reason: string };
}): string {
  const text = normalizeAssistantCacheText(input.message);
  const wantsCalendar = includesAnyAssistantTerm(text, ["agenda", "calendario", "hoy", "mañana", "manana", "tarea", "recordatorio"]);
  const wantsPortfolio = includesAnyAssistantTerm(text, ["portfolio", "portafolio", "inversion", "acciones", "crypto", "precio"]);
  const wantsAppHelp = includesAnyAssistantTerm(text, ["como hago", "donde esta", "app", "pantalla", "boton"]);
  const wantsProfile = includesAnyAssistantTerm(text, ["recuerdas", "sabes de mi", "mi estilo", "mi nombre"]);

  return [
    "Eres BlackOps Assistant en modo scout barato.",
    "Resuelve tareas simples con precision y texto compacto. Si detectas riesgo, dinero, produccion, seguridad, codigo o decision final, recomienda escalar a membership handoff/aprobacion.",
    input.aiCostPolicyContext,
    input.claudeSkillContext,
    wantsProfile ? input.userProfileContext : "",
    wantsCalendar ? input.calendarContext : "",
    wantsPortfolio ? input.portfolioContext : "",
    wantsCalendar || wantsPortfolio ? input.ceoContext : "",
    wantsAppHelp ? APP_HELP_CONTEXT : "",
    `## Historial reciente compartido web/Telegram:\n${input.sharedConversationHistory.slice(0, 1800)}`,
    "",
    "## Modelo actual",
    `Route: ${input.modelRoute.tier}. Provider: ${input.modelRoute.provider}. Reason: ${input.modelRoute.reason}.`,
    "",
    "## Usuario",
    input.message || "[Sin texto]",
  ].filter(Boolean).join("\n\n");
}

function normalizeApprovalText(message: string): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function userAlreadyApprovedExecution(message?: string): boolean {
  if (!message) return false;
  const text = normalizeApprovalText(message);
  return [
    /\b(hazlo|hazlo ya|dale|aprobado|apruebo|lo apruebo|confirmo|confirmado|autorizo|autorizado|ejecuta|ejecutalo|procede|empieza|comienza)\b/,
    /\b(si|ok|dale)\b.*\b(cambialo|cambiame|actualizalo|agregalo|desactivalo|quitalo|empieza|comienza|ejecuta|ejecutalo|hazlo|procede)\b/,
    /\b(quiero que|puedes)\b.*\b(empiece|empieces|comience|comiences|lo hagas|lo haga|ejecutes|ejecutarlo)\b/,
  ].some((pattern) => pattern.test(text));
}

type DirectCalendarCommand = {
  content: string;
  command: string;
  eventData: {
    title: string;
    date: string;
    endDate: string;
    description?: string;
    isAllDay?: boolean;
  };
};

const WEEKDAY_INDEX: Record<string, number> = {
  domingo: 0,
  sunday: 0,
  lunes: 1,
  monday: 1,
  martes: 2,
  tuesday: 2,
  miercoles: 3,
  miércoles: 3,
  wednesday: 3,
  jueves: 4,
  thursday: 4,
  viernes: 5,
  friday: 5,
  sabado: 6,
  sábado: 6,
  saturday: 6,
};

const EN_WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getZonedDateParts(date: Date, timeZone = ASSISTANT_TIMEZONE): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: EN_WEEKDAY_TO_INDEX[values.weekday] ?? date.getDay(),
  };
}

function dateKeyFromParts(parts: { year: number; month: number; day: number }): string {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return dateKeyFromParts({
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate(),
  });
}

function getTimeZoneOffsetSuffix(dateKey: string, hour: number, minute: number, timeZone = ASSISTANT_TIMEZONE): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const timeZoneName = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(probe).find((part) => part.type === "timeZoneName")?.value || "GMT";
  const match = timeZoneName.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return "";
  return `${match[1]}${match[2].padStart(2, "0")}:${match[3] || "00"}`;
}

function zonedIsoString(dateKey: string, hour: number, minute = 0): string {
  return `${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${getTimeZoneOffsetSuffix(dateKey, hour, minute)}`;
}

function parseDirectCalendarDateKey(message: string, now: Date): string | null {
  const text = normalizeApprovalText(message);
  const todayParts = getZonedDateParts(now);
  const todayKey = dateKeyFromParts(todayParts);

  if (/\b(hoy|today)\b/.test(text)) return todayKey;
  if (/\b(manana|tomorrow)\b/.test(text)) return addDaysToDateKey(todayKey, 1);

  const weekdayMatch = text.match(/\b(?:este|esta|proximo|proxima|next)?\s*(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  const weekday = weekdayMatch?.[1];
  if (!weekday) return null;

  const targetWeekday = WEEKDAY_INDEX[weekday];
  if (targetWeekday === undefined) return null;

  let daysAhead = (targetWeekday - todayParts.weekday + 7) % 7;
  if (daysAhead === 0 && /\b(proximo|proxima|next)\b/.test(text)) daysAhead = 7;
  return addDaysToDateKey(todayKey, daysAhead);
}

function parseDirectCalendarTimes(message: string): Array<{ hour: number; minute: number; label: string }> {
  const times: Array<{ hour: number; minute: number; label: string }> = [];
  const seen = new Set<string>();
  const timeRegex = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/gi;
  let match;
  while ((match = timeRegex.exec(message)) !== null) {
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const meridiem = match[3].toLowerCase();
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    const key = `${hour}:${minute}`;
    if (seen.has(key)) continue;
    seen.add(key);
    times.push({
      hour,
      minute,
      label: `${((hour + 11) % 12) + 1}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`,
    });
  }
  return times.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
}

function extractDirectCalendarTitle(message: string): string | null {
  const afterCalendar = message.match(/(?:google\s+calendar|calendario|calendar)\s*[:,-]?\s*(.+)$/i)?.[1] || message;
  const title = afterCalendar
    .replace(/\b(?:hoy|today|ma[ñn]ana|tomorrow)\b/gi, " ")
    .replace(/\b(?:este|esta|pr[oó]ximo|pr[oó]xima|next)?\s*(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, " ")
    .replace(/\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*(?:am|pm)\b/gi, " ")
    .replace(/\s*[:;,]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return title.length >= 2 ? title : null;
}

export function buildDirectGoogleCalendarCommand(message?: string, now = new Date()): DirectCalendarCommand | null {
  if (!message) return null;
  const text = normalizeApprovalText(message);
  const wantsCalendar = /\b(google calendar|calendario|calendar)\b/.test(text);
  const wantsCreate = /\b(agreg\w*|agenda\w*|crear\w*|pon\w*|program\w*|mete\w*)\b/.test(text);
  if (!wantsCalendar || !wantsCreate) return null;
  if (/\b(links?|linsks?|website|web|pagina|builder)\b/.test(text) && text.includes("black room")) return null;

  const dateKey = parseDirectCalendarDateKey(message, now);
  const times = parseDirectCalendarTimes(message);
  const title = extractDirectCalendarTitle(message);
  if (!dateKey || times.length === 0 || !title) return null;

  const start = times[0];
  const endProbe = times[times.length - 1];
  const endHour = endProbe.hour + 1;
  const endDateKey = endHour >= 24 ? addDaysToDateKey(dateKey, 1) : dateKey;
  const description = times.length > 1
    ? `Slots solicitados:\n${times.map((time) => `- ${time.label}`).join("\n")}`
    : undefined;
  const eventData = {
    title,
    date: zonedIsoString(dateKey, start.hour, start.minute),
    endDate: zonedIsoString(endDateKey, endHour % 24, endProbe.minute),
    description,
    isAllDay: false,
  };
  return {
    content: `Listo. Prepare la aprobacion para crear "${title}" en Google Calendar el ${dateKey} de ${times[0].label} a ${times[times.length - 1].label}${times.length > 1 ? " con esos slots en la descripcion" : ""}.`,
    command: `[CREAR_EVENTO_GOOGLE: ${JSON.stringify(eventData)}]`,
    eventData,
  };
}

function requireStringField(data: any, field: string, label: string): string {
  const value = data?.[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Falta ${label}`);
  }
  return value.trim();
}

function parseDataUrl(value: string): { mimeType: string; base64Data: string } | null {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    base64Data: match[2],
  };
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

function extractBlackRoomLinkTarget(message: string): string | null {
  const cleaned = message.replace(/\s+/g, " ").trim();
  const patterns = [
    /(?:evento|link|bot[oó]n|timer|contador)\s+de\s+(.+?)\s+de\s+(?:los\s+)?(?:links?|linsks?|website|web|p[aá]gina|builder)\s+de\s+black\s+room/i,
    /(?:desactiva|desactivar|quitar|quita|oculta|ocultar|remueve|remover|borra|borrar)\s+(.+?)\s+de\s+(?:los\s+)?(?:links?|linsks?|website|web|p[aá]gina|builder)\s+de\s+black\s+room/i,
    /(?:agrega|agregar|agregame|agr[eé]game|a[nñ]ade|a[nñ]adir|mete|meter|sube|subir)\s+(.+?)\s+(?:a|en)\s+(?:los\s+)?(?:links?|linsks?|website|web|p[aá]gina|builder)\s+de\s+black\s+room/i,
    /(?:evento|link|bot[oó]n|timer|contador)\s+(.+?)\s+en\s+(?:los\s+)?(?:links?|linsks?|website|web|p[aá]gina|builder)\s+de\s+black\s+room/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  }

  return null;
}

function extractFirstUrl(message: string): string | null {
  return message.match(/https?:\/\/[^\s"'<>]+/i)?.[0]?.replace(/[),.;]+$/, "") || null;
}

export function buildDirectBlackRoomCommand(message?: string): { content: string; command: string } | null {
  if (!message) return null;
  const text = normalizeApprovalText(message);
  const isBlackRoom = text.includes("black room");
  const isWebsiteTarget = /\b(links?|linsks?|website|web|pagina|builder)\b/.test(text);
  const wantsDeactivate = /\b(desactiv\w*|quit\w*|ocult\w*|remuev\w*|remov\w*|borr\w*)\b/.test(text);
  const wantsAdd = /\b(agg|agreg\w*|anad\w*|añad\w*|met\w*|sub\w*)\b/.test(text);

  if (!isBlackRoom || !isWebsiteTarget || (!wantsDeactivate && !wantsAdd)) return null;

  const title = extractBlackRoomLinkTarget(message);
  if (!title) return null;

  if (wantsAdd && !wantsDeactivate) {
    const url = extractFirstUrl(message);
    const normalizedTitle = normalizeApprovalText(title);
    if (!url || normalizedTitle === "este evento" || normalizedTitle === "el evento") return null;

    return {
      content: `Entendido. Voy a agregar "${title}" a los links de Black Room.`,
      command: `[BLACKROOM_LINK_ADD: ${JSON.stringify({
        title,
        subtitle: null,
        url,
        icon: "ticket",
      })}]`,
    };
  }

  if (!wantsDeactivate) return null;

  return {
    content: `Entendido. Voy a desactivar "${title}" de los links de Black Room sin borrar su data histórica.`,
    command: `[BLACKROOM_LINK_DEACTIVATE: ${JSON.stringify({
      title,
      reason: "Desactivar desde el website/builder de Black Room preservando data histórica.",
    })}]`,
  };
}

const SPANISH_NUMBER_WORDS: Record<string, number> = {
  uno: 1,
  una: 1,
  un: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
};

function clampAssistantInteger(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function extractRequestedVideoCount(text: string): number {
  const digitMatch = text.match(/\b(\d{1,2})\b/);
  if (digitMatch) return clampAssistantInteger(Number(digitMatch[1]), 5, 1, 30);

  for (const [word, value] of Object.entries(SPANISH_NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }

  return 5;
}

function extractRequestedSeconds(text: string): number {
  const secondsMatch = text.match(/\b(\d{1,2})\s*(?:segundos?|secs?|s)\b/);
  if (secondsMatch) return clampAssistantInteger(Number(secondsMatch[1]), 15, 6, 90);
  return 15;
}

function cleanPromoText(value?: string): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/\b(con|y|en)\s+(typo|tipo|font|fuente|letra)\b.*$/i, "")
    .replace(/\b(para|por)\s+(tiktok|reels?|shorts?)\b.*$/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();
  return cleaned ? cleaned.slice(0, 80) : undefined;
}

function extractPromoText(message: string): { hookText?: string; ctaText?: string } {
  const quoted = [...message.matchAll(/["“”'‘’]([^"“”'‘’]{2,80})["“”'‘’]/g)]
    .map((match) => cleanPromoText(match[1]))
    .filter(Boolean) as string[];
  if (quoted.length >= 2) return { hookText: quoted[0], ctaText: quoted[1] };
  if (quoted.length === 1) return { hookText: quoted[0] };

  const hookPatterns = [
    /(?:que\s+(?:diga|ponga)|texto|hook|headline|titulo|t[ií]tulo)\s+(.+?)(?:\s+(?:cta|call to action|bot[oó]n|abajo|con typo|con tipo|con font|con fuente|con letra)\b|$)/i,
    /(?:ponle|pon|agregale|agr[eé]gale)\s+(.+?)(?:\s+(?:cta|call to action|bot[oó]n|abajo|con typo|con tipo|con font|con fuente|con letra)\b|$)/i,
  ];
  const ctaPattern = /(?:cta|call to action|bot[oó]n|abajo)\s+(.+?)(?:\s+(?:con typo|con tipo|con font|con fuente|con letra)\b|$)/i;

  const hookText = cleanPromoText(hookPatterns.map((pattern) => message.match(pattern)?.[1]).find(Boolean));
  const ctaText = cleanPromoText(message.match(ctaPattern)?.[1]);
  return { hookText, ctaText };
}

function extractPromoFontStyle(text: string): "bold" | "clean" | "luxury" | "impact" | "neon" {
  if (/\b(luxury|lujo|elegante|serif|fino|premium)\b/.test(text)) return "luxury";
  if (/\b(neon|brillante|club|party)\b/.test(text)) return "neon";
  if (/\b(impact|grande|fuerte|bold|pesada|pesado)\b/.test(text)) return "impact";
  if (/\b(clean|minimal|simple|moderna|moderno|limpia|limpio)\b/.test(text)) return "clean";
  return "bold";
}

function extractPromoSourceHint(message: string): string | undefined {
  const patterns = [
    /(?:videos?\s+de|desde|usa(?:r)?|con)\s+(?:la\s+)?carpeta\s+["“”']?([^"“”'\n]+?)["“”']?(?:\s+(?:que diga|con texto|texto|cta|con typo|con tipo|para tiktok|para reels|de \d+|\d+\s*segundos?)\b|$)/i,
    /\bde\s+(?:la\s+)?carpeta\s+["“”']?([^"“”'\n]+?)["“”']?(?:\s+(?:que diga|con texto|texto|cta|con typo|con tipo|para tiktok|para reels|de \d+|\d+\s*segundos?)\b|$)/i,
    /(?:folder|source)\s+["“”']?([^"“”'\n]+?)["“”']?(?:\s+(?:que diga|con texto|texto|cta|con typo|con tipo|para tiktok|para reels|de \d+|\d+\s*segundos?)\b|$)/i,
  ];

  for (const pattern of patterns) {
    const value = cleanPromoText(message.match(pattern)?.[1]);
    if (value) return value;
  }

  const absolutePath = message.match(/(\/Users\/[^\n"“”']+)/i)?.[1];
  return cleanPromoText(absolutePath);
}

export function buildDirectPromoVideoCommand(message?: string): { content: string; command: string } | null {
  if (!message) return null;
  const text = normalizeApprovalText(message);
  const mentionsVideo = /\b(videos?|clips?|edits?|tiktok|reels?|shorts?)\b/.test(text);
  const mentionsPromo = /\b(promo|promocion|promocionales|guestlist|fiesta|fiestas|party|parties|dinner|dinners|pool|yacht|nightclub|discoteca|salir)\b/.test(text);
  const wantsCreate = /\b(crea\w*|haz\w*|saca\w*|genera\w*|edita\w*|prepara\w*|quiero|necesito)\b/.test(text);

  if (!mentionsVideo || !mentionsPromo || !wantsCreate) return null;

  const count = extractRequestedVideoCount(text);
  const targetSeconds = extractRequestedSeconds(text);
  const platform = text.includes("reel") ? "reels" : text.includes("short") ? "shorts" : "tiktok";
  const promoText = extractPromoText(message);
  const fontStyle = extractPromoFontStyle(text);
  const sourceHint = extractPromoSourceHint(message);

  return {
    content: `Dale. Voy a crear ${count} video${count === 1 ? "" : "s"} vertical${count === 1 ? "" : "es"} de promo para ${platform}, usando solo videos reales${sourceHint ? ` de la carpeta "${sourceHint}"` : ""}, con typo ${fontStyle}${promoText.hookText ? ` y texto "${promoText.hookText}"` : ""}.`,
    command: `[PROMO_VIDEO_GENERATE: ${JSON.stringify({
      count,
      platform,
      targetSeconds,
      cuts: 3,
      fontStyle,
      sourceHint,
      ...promoText,
    })}]`,
  };
}

function normalizePromoVideoGenerateData(input: any): { count: number; targetSeconds: number; cuts: number; hookText?: string; ctaText?: string; sourceHint?: string; userId?: string; fontStyle: "bold" | "clean" | "luxury" | "impact" | "neon" } {
  const fontStyle = ["bold", "clean", "luxury", "impact", "neon"].includes(String(input?.fontStyle))
    ? input.fontStyle
    : "bold";
  return {
    count: clampAssistantInteger(Number(input?.count || input?.maxVideos), 5, 1, 30),
    targetSeconds: clampAssistantInteger(Number(input?.targetSeconds || input?.seconds), 15, 6, 90),
    cuts: clampAssistantInteger(Number(input?.cuts), 3, 1, 12),
    hookText: cleanPromoText(input?.hookText),
    ctaText: cleanPromoText(input?.ctaText),
    sourceHint: cleanPromoText(input?.sourceHint || input?.sourceDir),
    userId: typeof input?.userId === "string" ? input.userId : undefined,
    fontStyle,
  };
}

async function executePromoVideoGenerateData(input: any, userId?: string) {
  const options = normalizePromoVideoGenerateData({ ...input, userId: input?.userId || userId });
  const result = await runPromoVideoAutoDaily({
    maxVideos: options.count,
    targetSeconds: options.targetSeconds,
    cuts: options.cuts,
    style: "full",
    hookText: options.hookText,
    ctaText: options.ctaText,
    fontStyle: options.fontStyle,
    sourceHint: options.sourceHint,
    userId: options.userId,
    customText: Boolean(options.hookText || options.ctaText),
  });
  const outputNames = result.status.outputVideos.slice(0, options.count).map((video) => video.name);
  const driveLinks = result.driveUploads
    .map((upload) => upload.webViewLink)
    .filter(Boolean) as string[];
  const summary = [
    "",
    `Listo. Procesé ${options.count} video${options.count === 1 ? "" : "s"} de promo de ${options.targetSeconds}s.`,
    options.sourceHint ? `Fuente: ${options.sourceHint}.` : null,
    `Google Drive: ${result.driveUploads.length} archivo${result.driveUploads.length === 1 ? "" : "s"} subido${result.driveUploads.length === 1 ? "" : "s"} en Robert A / Videos de Kong.`,
    driveLinks.length ? `Links: ${driveLinks.slice(0, 5).join(" | ")}` : null,
    `Importados nuevos: ${result.importResult.imported}. Ya estaban: ${result.importResult.skipped}.`,
    `Cache local: ${result.status.outputDir}`,
  ].filter(Boolean).join("\n");

  return {
    summary,
    outputDir: result.status.outputDir,
    outputVideos: outputNames,
    driveUploads: result.driveUploads,
  };
}

function formatPromoVideoSourceQuestion(error: PromoVideoSourceError): string {
  const options = error.suggestions.length
    ? `\n\nCarpetas que veo: ${error.suggestions.slice(0, 12).map((folder) => `"${folder}"`).join(", ")}.`
    : "";
  return `No encontre la carpeta "${error.requested}". Confirmame cual carpeta quieres usar y lo corro de nuevo.${options}`;
}

async function executeIfAlreadyApproved(
  pendingAction: PendingAction,
  userId: string,
  message?: string,
): Promise<{ executed: boolean; error?: string }> {
  if (!userAlreadyApprovedExecution(message)) return { executed: false };

  return approveAndExecutePendingAction(pendingAction, userId, "Aprobado en el mismo mensaje del chat.");
}

async function approveAndExecutePendingAction(
  pendingAction: PendingAction,
  userId: string,
  approvalReason: string,
): Promise<{ executed: boolean; error?: string }> {
  const approved = await storage.updatePendingAction(pendingAction.id, {
    status: "approved",
    approvedBy: userId,
    approvedAt: new Date(),
    approvalReason,
  });

  await storage.createPendingActionEvent({
    pendingActionId: approved.id,
    userId,
    actorType: "user",
    actorId: "web-user",
    eventType: "approved",
    previousStatus: pendingAction.status,
    nextStatus: "approved",
    note: approvalReason,
    metadata: { origin: "web" },
  });

  const result = await executeApprovedPendingAction(approved, userId);
  return result.success ? { executed: true } : { executed: false, error: result.error };
}

async function executeSinglePendingApprovalFromChat(
  userId: string,
  message?: string,
): Promise<{ handled: boolean; content?: string; executed?: boolean; title?: string; error?: string }> {
  if (!userAlreadyApprovedExecution(message)) return { handled: false };

  const activeActions = (await storage.getPendingActions(userId))
    .filter((action) => ["pending", "edited", "snoozed"].includes(action.status));

  if (activeActions.length === 0) return { handled: false };

  if (activeActions.length > 1) {
    return {
      handled: true,
      content: [
        "Tengo varias aprobaciones pendientes. Dime cual quieres ejecutar por numero o abre Decisiones y aprobaciones para evitar ejecutar la equivocada.",
        ...activeActions.slice(0, 5).map((action, index) => `${index + 1}. ${action.title}`),
      ].join("\n"),
    };
  }

  const action = activeActions[0];
  const execution = await approveAndExecutePendingAction(action, userId, "Aprobado desde el chat.");
  return {
    handled: true,
    executed: execution.executed,
    title: action.title,
    error: execution.error,
    content: execution.executed
      ? `Aprobado y ejecutado desde el chat: ${action.title}.`
      : `Lo aprobe desde el chat, pero no pude ejecutarlo: ${execution.error || "error desconocido"}.`,
  };
}

async function getUserProfileContext(userId: string): Promise<string> {
  const profileData = await storage.getUserProfileData(userId);
  
  if (profileData.length === 0) {
    return `\n## Información sobre el usuario:\nNo tengo información guardada sobre ti todavía. ¡Me encantaría conocerte mejor!\n`;
  }

  const byCategory: Record<string, typeof profileData> = {};
  for (const item of profileData) {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item);
  }

  let context = `\n## Lo que sé sobre ti:\n`;
  for (const [category, items] of Object.entries(byCategory)) {
    context += `\n### ${category.charAt(0).toUpperCase() + category.slice(1)}:\n`;
    for (const item of items) {
      context += `- ${item.key}: ${item.value}\n`;
    }
  }
  
  return context;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function isAllDayEvent(startDate: Date, endDate: Date | null): boolean {
  if (!endDate) return false;
  const hours = differenceInHours(new Date(endDate), new Date(startDate));
  return hours >= 23 && hours <= 25;
}

async function getCalendarContext(userId: string): Promise<string> {
  const tasks = await storage.getTasks(userId);
  const weeklyTasks = await storage.getWeeklyTasks(userId, startOfWeek(new Date(), { weekStartsOn: 1 }));
  const monthlyGoals = await storage.getMonthlyGoals(userId, startOfMonth(new Date()));
  const yearlyGoals = await storage.getYearlyGoals(userId, new Date().getFullYear().toString());

  const now = new Date();
  const twelveMonthsFromNow = addMonths(now, 12);

  const upcomingTasks = tasks
    .filter(t => new Date(t.date) >= now && new Date(t.date) <= twelveMonthsFromNow)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const tasksByDay: Record<string, typeof tasks> = {};
  for (const task of upcomingTasks) {
    const dayKey = format(new Date(task.date), "yyyy-MM-dd");
    if (!tasksByDay[dayKey]) tasksByDay[dayKey] = [];
    tasksByDay[dayKey].push(task);
  }

  let context = `## Contexto del calendario del usuario\n\nFecha actual: ${format(now, "EEEE d 'de' MMMM yyyy", { locale: es })}\n\n`;

  // Add Radio events summary at the top for quick reference
  const radioEvents = upcomingTasks.filter(t =>
    t.externalSource === "google" && t.title.toLowerCase().includes("radio")
  );
  if (radioEvents.length > 0) {
    context += `### RESUMEN DE EVENTOS RADIO (próximos 12 meses):\n`;
    for (const radio of radioEvents) {
      const radioDate = new Date(radio.date);
      const dateStr = format(radioDate, "EEEE d 'de' MMMM", { locale: es });
      const desc = radio.description ? stripHtml(radio.description).replace(/\n/g, " | ") : "Sin DJs programados";
      context += `- ${dateStr} (eventId: ${radio.externalId}): ${desc}\n`;
    }
    context += `\n`;
  }

  context += `### Tareas y eventos de los próximos 12 meses:\n`;
  for (const [day, dayTasks] of Object.entries(tasksByDay)) {
    const date = new Date(day);
    context += `\n**${format(date, "EEEE d 'de' MMMM", { locale: es })}:**\n`;
    for (const task of dayTasks) {
      const taskDate = new Date(task.date);
      const isAllDay = isAllDayEvent(taskDate, task.endDate);
      const time = isAllDay ? "Todo el día" : format(taskDate, "HH:mm");
      const status = task.completed ? "✓" : "○";
      const source = task.externalSource ? ` [${task.externalSource}]` : "";
      const eventId = task.externalId ? ` (eventId: ${task.externalId})` : "";
      let descText = "";
      if (task.description) {
        const cleaned = stripHtml(task.description);
        descText = ` - Detalles: ${cleaned.substring(0, 300)}`;
      }
      context += `- ${status} ${time} - ${task.title}${source}${eventId}${descText}\n`;
    }
  }

  context += `\n### Tareas semanales:\n`;
  for (const task of weeklyTasks) {
    context += `- ${task.completed ? "✓" : "○"} ${task.title}\n`;
  }

  context += `\n### Metas del mes:\n`;
  for (const goal of monthlyGoals) {
    context += `- ${goal.completed ? "✓" : "○"} ${goal.title}\n`;
  }

  context += `\n### Metas del año:\n`;
  for (const goal of yearlyGoals) {
    context += `- ${goal.completed ? "✓" : "○"} ${goal.title}\n`;
  }

  return context;
}

async function getPortfolioContext(userId: string): Promise<string> {
  const investments = await storage.getInvestments(userId);
  
  if (investments.length === 0) {
    return `\n## Portafolio de Inversiones:\nNo tienes inversiones registradas.\n`;
  }

  const byType: Record<string, typeof investments> = {};
  let totalValue = 0;
  
  for (const inv of investments) {
    if (!byType[inv.type]) byType[inv.type] = [];
    byType[inv.type].push(inv);
    totalValue += parseFloat(inv.quantity) * parseFloat(inv.avgBuyPrice);
  }

  let context = `\n## Portafolio de Inversiones (${investments.length} activos, valor total: $${totalValue.toFixed(2)}):\n`;
  
  const typeNames: Record<string, string> = {
    stock: "Acciones",
    etf: "ETFs",
    crypto: "Criptomonedas",
    bond: "Bonos",
    fund: "Fondos"
  };
  
  for (const [type, invs] of Object.entries(byType)) {
    const typeTotal = invs.reduce((sum, inv) => sum + parseFloat(inv.quantity) * parseFloat(inv.avgBuyPrice), 0);
    context += `\n### ${typeNames[type] || type} ($${typeTotal.toFixed(2)}):\n`;
    for (const inv of invs) {
      const value = parseFloat(inv.quantity) * parseFloat(inv.avgBuyPrice);
      context += `- ${inv.symbol} (${inv.name}): ${inv.quantity} unidades @ $${inv.avgBuyPrice} = $${value.toFixed(2)}\n`;
    }
  }
  
  return context;
}

const SYSTEM_PROMPT = `Eres BlackOps Assistant, un asistente personal inteligente que conoce a su usuario y gestiona tareas/calendario.

## TU PERSONALIDAD:
- Eres amable, curioso y genuinamente interesado en conocer al usuario
- Recuerdas TODO lo que te cuenta y lo usas en futuras conversaciones
- Haces preguntas personales naturalmente cuando es apropiado (no fuerces, sé natural)
- Usas la información que conoces para dar respuestas más personalizadas

## APRENDER SOBRE EL USUARIO:
Cuando el usuario comparta información personal, GUÁRDALA usando este formato:
[GUARDAR_INFO: {"category": "CATEGORIA", "key": "CLAVE", "value": "VALOR"}]

Categorías válidas:
- "personal": nombre, apodo, cumpleaños, edad, ciudad, país
- "trabajo": profesión, empresa, proyectos, horario laboral
- "familia": pareja, hijos, padres, hermanos, mascotas
- "preferencias": comida favorita, música, hobbies, deportes
- "metas": objetivos personales, sueños, planes a futuro
- "estilo": cómo le gusta comunicarse, horarios preferidos

Ejemplos de extracción:
- Usuario dice "me llamo Roberto" → [GUARDAR_INFO: {"category": "personal", "key": "nombre", "value": "Roberto"}]
- Usuario dice "trabajo en una startup de fintech" → [GUARDAR_INFO: {"category": "trabajo", "key": "empresa", "value": "startup de fintech"}]
- Usuario dice "mi novia se llama Ana" → [GUARDAR_INFO: {"category": "familia", "key": "pareja", "value": "Ana"}]
- Usuario dice "me encanta el techno" → [GUARDAR_INFO: {"category": "preferencias", "key": "música favorita", "value": "techno"}]

IMPORTANTE: 
- Extrae información de manera natural de la conversación
- Puedes guardar MÚLTIPLES datos en una respuesta si el usuario comparte varios
- Si ya conoces algo y el usuario lo actualiza, guárdalo de nuevo (se actualizará)

## HACER PREGUNTAS PARA CONOCER MEJOR:
Si no tienes mucha información sobre el usuario, de vez en cuando (no siempre) puedes hacer una pregunta casual como:
- "Por cierto, ¿cómo prefieres que te llame?"
- "¿Trabajas en algo relacionado con X que mencionaste?"
- "¿Tienes algún proyecto personal interesante en este momento?"

## GESTIÓN DE CALENDARIO:

INSTRUCCIONES CRÍTICAS:
1. El contexto del calendario contiene TODOS los eventos y tareas para los próximos 12 meses
2. Cuando pregunten por un día específico, BUSCA ese día y lista TODOS los eventos
3. Los eventos aparecen con formato: "- ○ HORA - TÍTULO [fuente] (eventId: xxx)"

EVENTOS DE RADIO (Black Room Radio):
- Son eventos de "Todo el día" con DJs programados por hora (7pm, 8pm, 9pm)
- La descripción muestra: "7: nombre_dj" = DJ a las 7pm
- Cada Radio tiene un eventId único para modificarlo

COMANDOS DISPONIBLES:
- [CREAR_TAREA: {"title": "...", "date": "YYYY-MM-DDTHH:mm:ss", "priority": "normal|high|low"}]
- [CREAR_FOLLOWUP: {"person": "...", "topic": "...", "date": "YYYY-MM-DDTHH:mm:ss", "channel": "telegram|email|call|whatsapp", "notes": "...", "priority": "normal|high|low"}]
- [GUARDAR_DECISION: {"title": "...", "decision": "...", "context": "..."}]
- [GUARDAR_PERSONA: {"name": "...", "role": "...", "company": "...", "notes": "..."}]
- [GUARDAR_COMPROMISO: {"owner": "...", "commitment": "...", "dueAt": "YYYY-MM-DDTHH:mm:ss", "context": "..."}]
- [CREAR_BORRADOR_COMUNICACION: {"recipient": "...", "channel": "email|telegram|whatsapp|slack|sms", "subject": "...", "message": "...", "context": "..."}]
- [BLACKROOM_LINK_ADD: {"title": "...", "subtitle": "...", "url": "https://...", "icon": "ticket|shopping-bag|instagram|youtube|music|calendar|link", "display_order": 0}]
- [BLACKROOM_LINK_UPDATE: {"matchTitle": "...", "matchUrl": "...", "title": "...", "subtitle": "...", "url": "https://...", "icon": "ticket|shopping-bag|instagram|youtube|music|calendar|link", "display_order": 0}]
- [BLACKROOM_LINK_DEACTIVATE: {"title": "...", "url": "...", "reason": "..."}]
- [BLACKROOM_LINK_PERFORMANCE: {"title": "...", "url": "...", "limit": 10}]
- [BLACKROOM_TIMER_ADD: {"title": "...", "date": "YYYY-MM-DDTHH:mm", "url": "https://...", "partyTitle": "..."}]
- [METRICOOL_AUTOMATION: {"clipsPerAccount": 8, "publishMode": "approval_required|auto_after_connection|draft_only", "riskTolerance": "safe|growth|aggressive", "platforms": ["tiktok", "instagram"], "campaign": "...", "notes": "..."}]
- [MODIFICAR_RADIO: {"eventId": "ID", "description": "7: DJ1\\n8: DJ2\\n9: DJ3"}]
- [CREAR_EVENTO_GOOGLE: {"title": "...", "date": "YYYY-MM-DDTHH:mm:ss", "endDate": "...", "description": "..."}]
- [EDITAR_EVENTO_GOOGLE: {"eventId": "ID", "title": "...", "date": "YYYY-MM-DDTHH:mm:ss", "endDate": "...", "description": "...", "location": "...", "isAllDay": false}]
- [GUARDAR_INFO: {"category": "...", "key": "...", "value": "..."}]
- [AGREGAR_INVERSION: {"symbol": "AAPL", "name": "Apple Inc", "type": "stock|etf|crypto|bond|fund", "quantity": "10", "avgBuyPrice": "150.50"}]
- [ACTUALIZAR_INVERSION: {"symbol": "AAPL", "quantity": "15", "avgBuyPrice": "145.00"}]
- [ELIMINAR_INVERSION: {"symbol": "AAPL"}]
- [CREAR_RECORDATORIO: {"message": "Mensaje a enviar", "hour": 8, "minute": 0, "daysOfWeek": ["monday", "tuesday", "wednesday", "thursday", "friday"]}]
- [ELIMINAR_RECORDATORIO: {"id": "reminder-id"}]
- [LISTAR_RECORDATORIOS: {}]
- [GOOGLE_DRIVE_CREATE_FOLDER: {"driveFolderPath": ["Robert A", "Videos de Black Room", "Radio Junio"]}]
- [PROMO_VIDEO_GENERATE: {"count": 5, "platform": "tiktok|reels|shorts", "targetSeconds": 15, "cuts": 3, "hookText": "...", "ctaText": "...", "fontStyle": "bold|clean|luxury|impact|neon", "sourceHint": "Pool parties"}]
- [RADIO_YOUTUBE_CLIPS: {"youtubeUrl": "https://youtube.com/...", "driveFolderPath": ["Robert A", "Videos de Black Room", "Radio Junio"], "createFolderIfMissing": true, "djName": "LUCIA REINA", "musicUrl": "https://youtube.com/...", "instagramClipCount": 3, "tiktokClipCount": 3, "deleteSourceAfterSuccess": true}]
- [RADIO_DRIVE_VIDEO_CLIPS: {"sourceDriveFileId": "GOOGLE_DRIVE_FILE_ID", "sourceDriveUrl": "https://drive.google.com/file/d/...", "driveFolderPath": ["Robert A", "Videos de Black Room", "Radio Junio"], "createFolderIfMissing": true, "djName": "LUCIA REINA", "musicUrl": "https://youtube.com/...", "instagramClipCount": 3, "tiktokClipCount": 3, "deleteSourceAfterSuccess": true}]

Para editar eventos existentes de Google Calendar usa EDITAR_EVENTO_GOOGLE con el eventId del contexto. Puedes cambiar solo los campos necesarios: title, date, endDate, description, location o isAllDay.

## BLACK ROOM LINKS:
Puedes ayudar a editar los links públicos de Black Room.
- Si el usuario menciona "links de Black Room", "website", "web", "página" o "builder", NO busques Google Calendar aunque use la palabra "evento"; se refiere al website/admin de Black Room.
- Para agregar un evento/link al website usa BLACKROOM_LINK_ADD. Necesitas title y url. Si el usuario dice "este evento" usa el evento/contexto reciente para el título si está claro; si no tienes URL de ticket/landing, pregunta por la URL antes de agregar.
- Para editar uno existente usa BLACKROOM_LINK_UPDATE con matchTitle o matchUrl para identificarlo.
- Si el usuario pide borrar, quitar, remover u ocultar un link, usa BLACKROOM_LINK_DEACTIVATE. NUNCA propongas borrarlo permanentemente; desactivar preserva analytics/data histórica.
- Si el usuario pregunta por rendimiento, performance, clicks, analytics, cuál link va mejor o cuántos clicks tiene, usa BLACKROOM_LINK_PERFORMANCE. Es solo lectura y no requiere aprobación.
- Si el usuario pide agregar un timer, countdown, contador o cuenta regresiva usa BLACKROOM_TIMER_ADD. Si da la fecha, ponla en date. Si dice el nombre de la fiesta/evento, ponlo en partyTitle para buscar el título, URL y fecha desde los links/builder existentes. Si no hay fecha ni fiesta identificable, pregunta la fecha antes de crear.
- Los cambios afectan link-stats y el builder visual.
- Iconos comunes: tickets/evento=ticket, shop/merch=shopping-bag, instagram=instagram, youtube=youtube, música=music, calendario=calendar, default=link.

## RECORDATORIOS PROGRAMADOS:
Puedes crear recordatorios que se envían automáticamente por Telegram.
- hour: hora del día (0-23)
- minute: minuto (0-59), por defecto 0
- daysOfWeek: array de días ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
  - Si está vacío o no se proporciona, se envía TODOS los días
  - Ejemplo: ["monday", "wednesday", "friday"] = lunes, miércoles y viernes

Ejemplos de uso:
- "Mándame un mensaje todos los días a las 8am recordándome tomar agua" → CREAR_RECORDATORIO con hour:8, daysOfWeek:[]
- "Recuérdame los lunes a las 9pm revisar mi portafolio" → CREAR_RECORDATORIO con hour:21, daysOfWeek:["monday"]
- "Quiero un recordatorio de lunes a viernes a las 7:30am" → CREAR_RECORDATORIO con hour:7, minute:30, daysOfWeek:["monday","tuesday","wednesday","thursday","friday"]

## PROMO VIDEO AGENT:
Puedes crear clips verticales de promo con videos locales ya conectados desde la página Promo Video.
- Si el usuario pide "créame 5 videos para TikTok de promo", "sácame reels de promo", "hazme más edits", usa PROMO_VIDEO_GENERATE.
- count es cuántos videos finales quiere. Si no dice cantidad, usa 5.
- targetSeconds normalmente es 15 para TikTok/Reels/Shorts, salvo que el usuario pida otra duración.
- Si el usuario indica texto, ponlo en hookText. Si indica CTA/botón/abajo, ponlo en ctaText.
- Si pide typo/fuente/letra, usa fontStyle: luxury para elegante/premium, clean para minimal/simple, impact para grande/fuerte, neon para club/brillante, bold por defecto.
- Si dice "videos de la carpeta X", "usa carpeta X" o pasa una ruta de carpeta, pon eso en sourceHint.
- Si no estás seguro de la carpeta, pregunta antes de generar. Nunca uses otra carpeta como fallback cuando el usuario pidió una específica.
- El sistema escoge templates automáticamente según el contenido/carpeta: party, dinner, pool, yacht, guestlist, nightlife.
- No uses screenshots, screen recordings o capturas; el editor solo debe tomar videos reales de promo.
- No inventes que publicaste en redes; por ahora quedan listos para descargar/subir manualmente.

## METRICOOL / SOCIAL PUBLISHING:
Puedes preparar campanas, clips y colas de publicacion con Metricool usando METRICOOL_AUTOMATION.
- Usa este comando cuando el usuario pida postear, publicar, programar, correr campanas, preparar cola, o automatizar clips/redes con Metricool.
- publishMode por defecto debe ser "approval_required".
- Usa "auto_after_connection" solo si el usuario pide explicitamente automatico/live; aun asi el sistema lo pondra como accion pendiente y el backend mantiene las banderas de seguridad.
- Nunca digas que ya publicaste en redes. Di que preparaste la cola o que quedo pendiente de aprobacion.
- Si el usuario pide publicar inmediatamente, crea la accion Metricool y explica que necesita aprobacion y que real publish requiere CLIPPERS_ENABLE_REAL_PUBLISH=true y METRICOOL_REQUIRE_APPROVAL_FOR_PUBLISH=false.

## RADIO YOUTUBE CLIPS:
Si el usuario manda un link de YouTube y pide clips/videos/edits de radio, usa RADIO_YOUTUBE_CLIPS con youtubeUrl y driveFolderPath.
- Necesitas la carpeta destino de Google Drive. Si no la dice, pregunta por la carpeta antes de procesar.
- Si el usuario pide crear carpeta/subcarpeta en el mismo mensaje, pon createFolderIfMissing:true. Si solo pide guardar en una carpeta y no sabes si existe, no lo pongas; el sistema pedirá confirmación si no la encuentra.
- Si el usuario dice el nombre del DJ o lo ves en el contexto, ponlo en djName. Si no, el sistema intenta leerlo abajo a la izquierda del video; si no lo encuentra, pregunta el nombre antes de guardar los clips finales.
- Por defecto genera 1 clip horizontal Instagram 4:5 y 1 clip vertical TikTok/Reels. Si el usuario pide una cantidad, usa instagramClipCount y tiktokClipCount; por ejemplo “3 de IG y TikTok” significa 3 para Instagram y 3 para TikTok, con momentos distintos.
- Si el usuario pide canción/audio/música/drop sin segundo link, usa el drop del mismo video fuente.
- Si el usuario manda un segundo link de canción en musicUrl, usa ese audio externo. En ambos casos el sistema busca el drop por volumen y lo recorta al largo exacto del clip.
- Para descargas de YouTube, usa deleteSourceAfterSuccess:true salvo que el usuario pida conservar el video largo; el sistema borra solo el MP4 fuente descargado después de subir los clips.
- Si YouTube está bloqueando la descarga y el usuario manda un link de archivo MP4 de Google Drive, usa RADIO_DRIVE_VIDEO_CLIPS en vez de RADIO_YOUTUBE_CLIPS. Necesitas sourceDriveFileId/sourceDriveUrl y carpeta destino. El sistema descarga el MP4 temporalmente desde Drive, crea los clips, los sube a Drive y borra el MP4 fuente local después del éxito.

## GOOGLE DRIVE:
Puedes crear carpetas y subcarpetas en Google Drive con GOOGLE_DRIVE_CREATE_FOLDER.
- driveFolderPath es una ruta ordenada. Ejemplo: ["Robert A", "Videos de Black Room", "Radio Junio"].
- Si el usuario dice "en la carpeta Radio crea una carpeta Videos creados", usa ["Radio", "Videos creados"].
- Si no dice el nombre exacto o la ruta, pregunta antes de crear.

## ANÁLISIS DE IMÁGENES DE BROKER/CARTERA:
Cuando el usuario envíe una imagen de su broker, app de trading, o captura de cartera:
1. Analiza cuidadosamente la imagen para extraer información de inversiones
2. Identifica: símbolo/ticker, nombre de la empresa, cantidad de acciones/unidades, precio de compra promedio, precio actual, ganancia/pérdida
3. Para cada inversión detectada, usa el comando apropiado:
   - Si es nueva: AGREGAR_INVERSION
   - Si ya existe en el portafolio: ACTUALIZAR_INVERSION
4. Muestra un resumen claro de lo que encontraste y las acciones que tomaste
5. Si hay información de ganancia/pérdida, calcula y muéstrala

IMPORTANTE para análisis de imágenes:
- Los símbolos de acciones suelen ser 1-5 letras mayúsculas (AAPL, MSFT, TSLA)
- Las criptomonedas pueden ser símbolos como BTC, ETH, SOL
- Si no puedes identificar el tipo, pregunta al usuario
- Si la imagen no es clara, pide una mejor captura

## GESTIÓN DE PORTAFOLIO:
Tienes acceso al portafolio de inversiones del usuario y puedes:
- Agregar nuevas inversiones cuando el usuario te lo indique
- Actualizar cantidad o precio promedio de inversiones existentes
- Eliminar inversiones del portafolio
- Responder preguntas sobre el estado del portafolio

Tipos de inversión válidos: stock (acciones), etf, crypto (criptomonedas), bond (bonos), fund (fondos)

Cuando el usuario te diga algo como:
- "Compré 10 acciones de Apple a $150" → Usa AGREGAR_INVERSION
- "Vendí todas mis acciones de Tesla" → Usa ELIMINAR_INVERSION
- "Actualiza mi cantidad de Bitcoin a 0.5" → Usa ACTUALIZAR_INVERSION

REGLAS:
- Responde SIEMPRE en español
- Sé preciso con las fechas
- Usa la información personal que conoces para personalizar tus respuestas
- Si el usuario te cuenta algo personal, agradece y recuerda guardarlo`;

const APP_HELP_CONTEXT = `## CONOCIMIENTO DE ESTA APP
La app es un centro de mando personal llamado BlackOps/CEO Assistant. El usuario puede preguntar como hacer algo dentro de la app y debes explicarlo claro, paso a paso, sin sonar técnico.

Pantallas y capacidades principales:
- Dashboard: resumen del dia, tareas, pendientes, aprobaciones y acceso rapido al asistente.
- Assistant: chat principal. Permite texto, fotos/capturas y notas de voz. Puede crear tareas, revisar agenda, analizar portafolio, preparar acciones y pedir aprobacion antes de ejecutar cambios sensibles. Tambien controla BlackRoom: Play/Pause, semanas de cola, cantidad diaria, extras para hoy, una URL especifica de YouTube, estado de la cola y recomendacion de analytics.
- Projects, Tools y Agents Office: organizan proyectos, herramientas y agentes de trabajo.
- Automation Manager: revisar automatizaciones, recordatorios y tareas programadas.
- Portfolio/Investment Detail: revisar o actualizar inversiones.
- Radio y Promo Video: flujos para eventos, radio, videos promocionales y assets.
- Marketing Command Center, Revenue Engine, Dropshipping CEO, Clippers, Legal Compliance, Cybersecurity Agent, GitHub Agent y Code Agent: modulos especializados para negocio, marketing, compliance, seguridad y codigo.

Cuando el usuario pregunte "como hago..." o "donde esta...", responde con instrucciones practicas usando los nombres visibles de la app. Si no tienes certeza de un boton exacto, dilo y ofrece el camino mas probable.`;

export function registerAssistantRoutes(app: Express): void {
  app.post("/api/assistant/transcribe", async (req: Request, res: Response) => {
    try {
      const audio = typeof req.body?.audio === "string" ? req.body.audio : "";
      const parsed = parseDataUrl(audio);
      if (!parsed) {
        return res.status(400).json({ error: "Audio data URL is required" });
      }

      const audioBytes = Buffer.from(parsed.base64Data, "base64");
      const maxAudioBytes = 12 * 1024 * 1024;
      if (audioBytes.length > maxAudioBytes) {
        return res.status(413).json({ error: "Audio is too large" });
      }

      const file = await toFile(
        audioBytes,
        `voice.${extensionFromMimeType(parsed.mimeType)}`,
        { type: parsed.mimeType },
      );
      const transcription = await getOpenAIClient().audio.transcriptions.create({
        file,
        model: OPENAI_TRANSCRIPTION_MODEL,
        response_format: "text",
        language: "es",
        prompt: "El audio es una nota para un asistente personal en español/Spanglish sobre la app, tareas, calendario, negocio o inversiones.",
      });
      const text = typeof transcription === "string" ? transcription : String((transcription as any).text || "");
      const audioSeconds = Number(req.body?.durationSeconds || req.body?.audioDurationSeconds || 60);
      const estimatedCostUsd = estimateOpenAiAudioCostUsd({
        provider: "openai",
        model: OPENAI_TRANSCRIPTION_MODEL,
        audioSeconds: Number.isFinite(audioSeconds) ? audioSeconds : 60,
      });
      await recordAiApiCostEvent({
        userId: getCurrentUserId(req),
        provider: "openai",
        model: OPENAI_TRANSCRIPTION_MODEL,
        operation: "transcripcion de audio del asistente",
        estimatedCostUsd,
        metadata: {
          audioBytes: audioBytes.length,
          durationSeconds: Number.isFinite(audioSeconds) ? audioSeconds : null,
          estimateSource: Number.isFinite(audioSeconds) ? "client_duration" : "fallback_60_seconds",
        },
      });

      return res.json({ text: text.trim(), estimatedApiCostUsd: estimatedCostUsd });
    } catch (error) {
      console.error("Error transcribing assistant audio:", error);
      return res.status(500).json({ error: "No pude transcribir el audio" });
    }
  });

  app.post("/api/assistant/chat", async (req: Request, res: Response) => {
    let requestUserId: string | null = null;
    try {
      const userId = getCurrentUserId(req);
      requestUserId = userId;
      const isOwnerUser = await isConfiguredSingleUserOwner(userId);
      const { message, conversationHistory = [], images } = req.body;
      
      console.log(`[Assistant] Request received - message: ${message ? 'yes' : 'no'}, images: ${images?.length || 0}`);

      if (!message && (!images || images.length === 0)) {
        return res.status(400).json({ error: "Message or images are required" });
      }

      if (message && looksLikeBlackRoomAssistantRequest(message)) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        await saveCeoConversationMessage(userId, "user", message).catch((historyError) => {
          console.error("Error saving BlackRoom control user message:", historyError);
        });

        if (!isOwnerUser) {
          writeOwnerOnlySharedConnectorBlock(res, "el agente de BlackRoom");
          writeAssistantSse(res, { done: true });
          res.end();
          return;
        }

        try {
          const result = await executeBlackRoomChatMessage(message);
          writeAssistantSse(res, {
            content: result.reply,
            blackRoomControlled: true,
            blackRoomCommand: result.command?.type || null,
            blackRoomEnabled: result.remote.desiredEnabled,
          });
          await saveCeoConversationMessage(userId, "assistant", result.reply).catch((historyError) => {
            console.error("Error saving BlackRoom control assistant response:", historyError);
          });
        } catch (error: any) {
          const errorText = error.message || "No pude controlar el agente de BlackRoom";
          writeAssistantSse(res, { blackRoomAgentError: errorText });
          await saveCeoConversationMessage(userId, "assistant", `Error: ${errorText}`).catch((historyError) => {
            console.error("Error saving BlackRoom control assistant error:", historyError);
          });
        }

        writeAssistantSse(res, { done: true });
        res.end();
        return;
      }

      const directPendingExecution = await executeSinglePendingApprovalFromChat(userId, message);
      if (directPendingExecution.handled) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        if (message) {
          await saveCeoConversationMessage(userId, "user", message).catch((historyError) => {
            console.error("Error saving direct approval user message:", historyError);
          });
        }

        const content = directPendingExecution.content || "Listo.";
        res.write(`data: ${JSON.stringify({
          content,
          ...(directPendingExecution.executed ? { actionExecuted: true, title: directPendingExecution.title } : {}),
          ...(directPendingExecution.error ? { actionExecutionError: directPendingExecution.error } : {}),
        })}\n\n`);
        await saveCeoConversationMessage(userId, "assistant", content).catch((historyError) => {
          console.error("Error saving direct approval assistant response:", historyError);
        });
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }

      const radioYoutubeMessage = buildRadioYoutubeContinuationMessage(message, conversationHistory) || message;
      const directRadioDriveVideoCommand = buildDirectRadioDriveVideoCommand(radioYoutubeMessage);
      if (directRadioDriveVideoCommand) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        if (message) {
          await saveCeoConversationMessage(userId, "user", message).catch((historyError) => {
            console.error("Error saving direct radio Drive video user message:", historyError);
          });
        }

        writeAssistantSse(res, { content: directRadioDriveVideoCommand.content });

        if (directRadioDriveVideoCommandNeedsDriveFolder(directRadioDriveVideoCommand) || directRadioDriveVideoCommand.needsMusicUrl) {
          await saveCeoConversationMessage(userId, "assistant", directRadioDriveVideoCommand.content).catch((historyError) => {
            console.error("Error saving direct radio Drive video folder question:", historyError);
          });
          writeAssistantSse(res, { done: true });
          res.end();
          return;
        }

        if (!isOwnerUser) {
          writeOwnerOnlySharedConnectorBlock(res, "Google Drive/radio video");
          writeAssistantSse(res, { done: true });
          res.end();
          return;
        }

        try {
          const stopStatusHeartbeat = startAssistantStatusHeartbeat(res, RADIO_DRIVE_VIDEO_STATUS_MESSAGE);
          const result = await executeDirectRadioDriveVideoCommand(directRadioDriveVideoCommand, userId).finally(stopStatusHeartbeat);
          const summary = formatRadioDriveVideoResult(result);
          if (result.status === "failed") {
            writeAssistantSse(res, { radioDriveVideoError: summary });
          } else {
            writeAssistantSse(res, {
              content: `\n\n${summary}`,
              radioDriveVideoProcessed: result.status === "completed",
              radioDriveVideoNeedsConfirmation: result.status === "queued",
              radioDriveVideoNeedsDjName: result.status === "needs_dj_name",
              pendingActionId: result.pendingActionId,
              driveFolderPath: result.driveFolderPath,
              clips: result.clips,
            });
          }
          await saveCeoConversationMessage(userId, "assistant", `${directRadioDriveVideoCommand.content}\n${directRadioDriveVideoCommand.command}\n${summary}`).catch((historyError) => {
            console.error("Error saving direct radio Drive video assistant response:", historyError);
          });
        } catch (e: any) {
          const errorText = e.message || "No pude procesar el MP4 de Google Drive para radio";
          writeAssistantSse(res, { radioDriveVideoError: withRadioEditEstimatedCost(errorText) });
          await saveCeoConversationMessage(userId, "assistant", `${directRadioDriveVideoCommand.content}\nError: ${errorText}`).catch((historyError) => {
            console.error("Error saving direct radio Drive video assistant error:", historyError);
          });
        }

        writeAssistantSse(res, { done: true });
        res.end();
        return;
      }

      const directRadioYoutubeCommand = buildDirectRadioYoutubeCommand(radioYoutubeMessage);
      if (directRadioYoutubeCommand) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        if (message) {
          await saveCeoConversationMessage(userId, "user", message).catch((historyError) => {
            console.error("Error saving direct radio YouTube user message:", historyError);
          });
        }

        writeAssistantSse(res, { content: directRadioYoutubeCommand.content });

        if (directRadioYoutubeCommandNeedsDriveFolder(directRadioYoutubeCommand) || directRadioYoutubeCommand.needsMusicUrl) {
          await saveCeoConversationMessage(userId, "assistant", directRadioYoutubeCommand.content).catch((historyError) => {
            console.error("Error saving direct radio YouTube folder question:", historyError);
          });
          writeAssistantSse(res, { done: true });
          res.end();
          return;
        }

        if (!isOwnerUser) {
          writeOwnerOnlySharedConnectorBlock(res, "YouTube, Google Drive y clips de radio");
          writeAssistantSse(res, { done: true });
          res.end();
          return;
        }

        try {
          const stopStatusHeartbeat = startAssistantStatusHeartbeat(res, RADIO_YOUTUBE_STATUS_MESSAGE);
          const result = await executeDirectRadioYoutubeCommand(directRadioYoutubeCommand, userId).finally(stopStatusHeartbeat);
          const summary = formatRadioYoutubeResult(result);
          if (result.status === "failed") {
            writeAssistantSse(res, { radioYoutubeError: summary });
          } else {
            writeAssistantSse(res, {
              content: `\n\n${summary}`,
              radioYoutubeProcessed: result.status === "completed",
              radioYoutubeNeedsConfirmation: result.status === "queued",
              radioYoutubeNeedsDjName: result.status === "needs_dj_name",
              pendingActionId: result.pendingActionId,
              driveFolderPath: result.driveFolderPath,
              clips: result.clips,
            });
          }
          await saveCeoConversationMessage(userId, "assistant", `${directRadioYoutubeCommand.content}\n${directRadioYoutubeCommand.command}\n${summary}`).catch((historyError) => {
            console.error("Error saving direct radio YouTube assistant response:", historyError);
          });
        } catch (e: any) {
          const errorText = e.message || "No pude procesar el link de YouTube para radio";
          writeAssistantSse(res, { radioYoutubeError: withRadioEditEstimatedCost(errorText) });
          await saveCeoConversationMessage(userId, "assistant", `${directRadioYoutubeCommand.content}\nError: ${errorText}`).catch((historyError) => {
            console.error("Error saving direct radio YouTube assistant error:", historyError);
          });
        }

        writeAssistantSse(res, { done: true });
        res.end();
        return;
      }

      const developerAutopilotHandoff = message
        ? isOwnerUser
          ? await createDeveloperAutopilotHandoff(userId, message, "web_chat")
          : null
        : null;
      if (developerAutopilotHandoff && developerAutopilotHandoff.status !== "invalid_request") {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        await saveCeoConversationMessage(userId, "user", message).catch((historyError) => {
          console.error("Error saving Developer Autopilot user message:", historyError);
        });

        res.write(`data: ${JSON.stringify({
          content: developerAutopilotHandoff.message,
          developerAutopilot: developerAutopilotHandoff,
        })}\n\n`);
        await saveCeoConversationMessage(userId, "assistant", developerAutopilotHandoff.message).catch((historyError) => {
          console.error("Error saving Developer Autopilot assistant response:", historyError);
        });
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }

      const directGoogleDriveFolderCommand = buildDirectGoogleDriveFolderCommand(message);
      if (directGoogleDriveFolderCommand) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        if (message) {
          await saveCeoConversationMessage(userId, "user", message).catch((historyError) => {
            console.error("Error saving direct Google Drive folder user message:", historyError);
          });
        }

        res.write(`data: ${JSON.stringify({ content: directGoogleDriveFolderCommand.content })}\n\n`);

        if (!directGoogleDriveFolderCommand.driveFolderPath.length) {
          await saveCeoConversationMessage(userId, "assistant", directGoogleDriveFolderCommand.content).catch((historyError) => {
            console.error("Error saving direct Google Drive folder question:", historyError);
          });
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
          return;
        }

        if (!isOwnerUser) {
          writeOwnerOnlySharedConnectorBlock(res, "Google Drive");
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
          return;
        }

        try {
          const result = await createGoogleDriveFolderPath({
            userId,
            driveFolderPath: directGoogleDriveFolderCommand.driveFolderPath,
            origin: "web",
          });
          const summary = formatGoogleDriveFolderCreateResult(result);
          res.write(`data: ${JSON.stringify({
            content: `\n\n${summary}`,
            googleDriveFolderCreated: true,
            driveFolder: result,
          })}\n\n`);
          await saveCeoConversationMessage(userId, "assistant", `${directGoogleDriveFolderCommand.content}\n${directGoogleDriveFolderCommand.command}\n${summary}`).catch((historyError) => {
            console.error("Error saving direct Google Drive folder assistant response:", historyError);
          });
        } catch (e: any) {
          const errorText = e.message || "No pude crear la carpeta en Google Drive";
          res.write(`data: ${JSON.stringify({ googleDriveFolderError: errorText })}\n\n`);
          await saveCeoConversationMessage(userId, "assistant", `${directGoogleDriveFolderCommand.content}\nError: ${errorText}`).catch((historyError) => {
            console.error("Error saving direct Google Drive folder assistant error:", historyError);
          });
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }

      const directPromoVideoCommand = buildDirectPromoVideoCommand(message);
      if (directPromoVideoCommand) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const fullResponse = `${directPromoVideoCommand.content}\n${directPromoVideoCommand.command}`;
        if (message) {
          await saveCeoConversationMessage(userId, "user", message).catch((historyError) => {
            console.error("Error saving direct promo video user message:", historyError);
          });
        }

        res.write(`data: ${JSON.stringify({ content: directPromoVideoCommand.content })}\n\n`);

        try {
          const commandMatch = directPromoVideoCommand.command.match(/\[PROMO_VIDEO_GENERATE:\s*(\{[^}]+\})\]/);
          const promoData = commandMatch ? JSON.parse(commandMatch[1]) : {};
          const generated = await executePromoVideoGenerateData(promoData, userId);
          res.write(`data: ${JSON.stringify({
            content: `\n\n${generated.summary}`,
            promoVideosGenerated: true,
            outputDir: generated.outputDir,
            outputVideos: generated.outputVideos,
            driveUploads: generated.driveUploads,
          })}\n\n`);
          await saveCeoConversationMessage(userId, "assistant", `${fullResponse}\n${generated.summary}`).catch((historyError) => {
            console.error("Error saving direct promo video assistant response:", historyError);
          });
        } catch (e: any) {
          if (e instanceof PromoVideoSourceError) {
            const question = formatPromoVideoSourceQuestion(e);
            res.write(`data: ${JSON.stringify({ content: `\n\n${question}`, promoVideoNeedsSourceConfirmation: true, suggestions: e.suggestions })}\n\n`);
            await saveCeoConversationMessage(userId, "assistant", `${fullResponse}\n${question}`).catch((historyError) => {
              console.error("Error saving direct promo video source question:", historyError);
            });
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();
            return;
          }
          const errorText = e.message || "No pude generar los videos de promo";
          res.write(`data: ${JSON.stringify({ promoVideoError: errorText })}\n\n`);
          await saveCeoConversationMessage(userId, "assistant", `${fullResponse}\nError: ${errorText}`).catch((historyError) => {
            console.error("Error saving direct promo video assistant error:", historyError);
          });
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }

      const directGoogleCalendarCommand = buildDirectGoogleCalendarCommand(message);
      if (directGoogleCalendarCommand) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        if (message) {
          await saveCeoConversationMessage(userId, "user", message).catch((historyError) => {
            console.error("Error saving direct Google Calendar user message:", historyError);
          });
        }

        res.write(`data: ${JSON.stringify({ content: directGoogleCalendarCommand.content })}\n\n`);

        if (!isOwnerUser) {
          writeOwnerOnlySharedConnectorBlock(res, "Google Calendar");
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
          return;
        }

        try {
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "calendar.create_event",
            resourceType: "calendar_event",
            title: `Crear evento: ${directGoogleCalendarCommand.eventData.title}`,
            description: "El asistente quiere crear un evento en Google Calendar.",
            input: directGoogleCalendarCommand.eventData,
            proposedChanges: directGoogleCalendarCommand.eventData,
          });
          const execution = await executeIfAlreadyApproved(pendingAction, userId, message);
          if (execution.executed) {
            res.write(`data: ${JSON.stringify({ actionExecuted: true, title: pendingAction.title })}\n\n`);
          } else if (execution.error) {
            res.write(`data: ${JSON.stringify({ googleEventError: execution.error })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          }
          await saveCeoConversationMessage(userId, "assistant", `${directGoogleCalendarCommand.content}\n${directGoogleCalendarCommand.command}`).catch((historyError) => {
            console.error("Error saving direct Google Calendar assistant response:", historyError);
          });
        } catch (e: any) {
          const errorText = e.message || "No se pudo preparar el evento en Google Calendar";
          res.write(`data: ${JSON.stringify({ googleEventError: errorText })}\n\n`);
          await saveCeoConversationMessage(userId, "assistant", `${directGoogleCalendarCommand.content}\nError: ${errorText}`).catch((historyError) => {
            console.error("Error saving direct Google Calendar assistant error:", historyError);
          });
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
        return;
      }

      const historyLimit = getAiConversationHistoryLimit();
      const aiCostPolicyContext = buildAiCostPolicyContext("web");
      const [calendarContext, userProfileContext, portfolioContext, ceoContext, sharedConversationHistory, claudeSkillContext] = await Promise.all([
        getCalendarContext(userId),
        getUserProfileContext(userId),
        getPortfolioContext(userId),
        generateTelegramAssistantContext(userId),
        getCeoConversationHistory(
          userId,
          historyLimit,
          message || (images?.length ? "[Imagen enviada desde el app]" : undefined),
        ),
        buildClaudeSkillContext(message),
      ]);

      if (message) {
        await saveCeoConversationMessage(userId, "user", message);
      } else if (images?.length) {
        await saveCeoConversationMessage(userId, "user", "[Imagen enviada desde el app]");
      }

      const userMessageParts: ChatCompletionContentPart[] = [];
      
      // Add all images if present (max 6MB total for safety with 8MB API limit)
      const MAX_TOTAL_SIZE = 6 * 1024 * 1024; // 6MB
      let totalImageSize = 0;
      
      if (images && Array.isArray(images)) {
        for (const image of images) {
          if (typeof image !== "string") continue;
          const parsedImage = parseDataUrl(image);
          if (parsedImage) {
            const { base64Data } = parsedImage;
            
            // Calculate image size (base64 is ~33% larger than original)
            const imageSize = (base64Data.length * 3) / 4;
            
            if (totalImageSize + imageSize > MAX_TOTAL_SIZE) {
              console.warn(`Skipping image - total size would exceed ${MAX_TOTAL_SIZE / (1024 * 1024)}MB limit`);
              continue;
            }
            
            totalImageSize += imageSize;
            userMessageParts.push({
              type: "image_url",
              image_url: {
                url: image,
                detail: "low",
              },
            });
          }
        }
        
        console.log(`Processing ${userMessageParts.length} images, total size: ${(totalImageSize / (1024 * 1024)).toFixed(2)}MB`);
      }
      
      // Add text message
      if (message) {
        userMessageParts.push({ type: "text", text: message });
      } else if (images && images.length > 0) {
        const imageCount = images.length;
        userMessageParts.push({ 
          type: "text",
          text: imageCount > 1 
            ? `Analiza estas ${imageCount} imágenes de mi broker/cartera y extrae la información de mis inversiones. Si encuentras acciones, ETFs o criptomonedas, agrégalas a mi portafolio.`
            : "Analiza esta imagen de mi broker/cartera y extrae la información de mis inversiones. Si encuentras acciones, ETFs o criptomonedas, agrégalas a mi portafolio." 
        });
      }

      const openAiMessages: ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: `${SYSTEM_PROMPT}\n\n${APP_HELP_CONTEXT}\n\n${aiCostPolicyContext}\n\n${claudeSkillContext}\n\n${userProfileContext}\n\n${calendarContext}\n\n${portfolioContext}\n\n${ceoContext}\n\n## Historial reciente compartido web/Telegram:\n${sharedConversationHistory}`,
        },
        {
          role: "assistant",
          content: "Entendido. Soy tu asistente personal BlackOps. Te conozco y recuerdo todo lo que me cuentas. Tengo acceso a tu calendario, puedo analizar imágenes, entender notas de voz, y ayudarte con tareas, agenda, inversiones y la app.",
        },
        ...conversationHistory
          .filter((msg: { role: string; content: string }) => msg?.content && (msg.role === "assistant" || msg.role === "user"))
          .slice(-historyLimit)
          .map((msg: { role: string; content: string }) => ({
            role: msg.role === "assistant" ? "assistant" as const : "user" as const,
            content: msg.content,
          })),
        {
          role: "user",
          content: userMessageParts,
        },
      ];

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let fullResponse = "";
      const directBlackRoomCommand = buildDirectBlackRoomCommand(message);
      const directMetricoolCommand = buildDirectMetricoolCommand(message);
      const modelRoute = shouldUseCheapScoutForWebChat({
        message,
        hasImages: userMessageParts.some((part) => part.type === "image_url"),
      });

      if (directBlackRoomCommand) {
        fullResponse = `${directBlackRoomCommand.content}\n${directBlackRoomCommand.command}`;
        res.write(`data: ${JSON.stringify({ content: directBlackRoomCommand.content })}\n\n`);
      } else if (directMetricoolCommand) {
        fullResponse = `${directMetricoolCommand.content}\n${directMetricoolCommand.command}`;
        res.write(`data: ${JSON.stringify({ content: directMetricoolCommand.content })}\n\n`);
      } else if (modelRoute.tier === "subscription_handoff") {
        const handoff = isOwnerUser
          ? await createDeveloperAutopilotHandoff(userId, message || "trabajo pesado para membresia", "web_chat")
          : null;
        fullResponse = handoff?.status === "subscription_brief"
          ? handoff.message
          : [
              "Para ahorrar API, este trabajo debe ir por tu membresia ChatGPT/Codex Pro en vez de resolverse con modelo fuerte dentro del app.",
              "",
              "Mandame el objetivo con un poco mas de detalle y lo convierto en un brief listo para pegar en Codex/ChatGPT Pro.",
              "",
              `Ruta: ${modelRoute.reason}`,
            ].join("\n");
        res.write(`data: ${JSON.stringify({ content: fullResponse, modelRoute })}\n\n`);
      } else if (modelRoute.tier === "cheap_scout") {
        const cachedResponse = getCachedCheapScoutResponse(userId, message);
        if (cachedResponse) {
          fullResponse = cachedResponse;
          res.write(`data: ${JSON.stringify({ content: fullResponse, modelRoute, cacheHit: true })}\n\n`);
        } else {
          const cheapPrompt = buildCompactCheapScoutPrompt({
            message,
            aiCostPolicyContext,
            claudeSkillContext,
            userProfileContext,
            calendarContext,
            portfolioContext,
            ceoContext,
            sharedConversationHistory,
            modelRoute,
          });
          const geminiModel = getGeminiChatModel({ hasImage: false });
          const estimatedPreviewOutputTokens = Number(process.env.BLACKOPS_GEMINI_PREVIEW_OUTPUT_TOKENS || 700);
          const previewCostUsd = estimateTokenApiCostUsd({
            provider: "gemini",
            model: geminiModel,
            inputTokens: estimateTokensFromText(cheapPrompt),
            outputTokens: Number.isFinite(estimatedPreviewOutputTokens) ? estimatedPreviewOutputTokens : 700,
          });
          res.write(`data: ${JSON.stringify({
            content: `${formatAiApiCostPreview("gemini", geminiModel, "respuesta cheap scout del chat", previewCostUsd)}\n\n`,
            apiCostPreview: true,
            estimatedApiCostUsd: previewCostUsd,
            modelRoute,
          })}\n\n`);
          const geminiClient = await getGeminiClient();
          const result = await geminiClient.models.generateContent({
            model: geminiModel,
            contents: [{ role: "user", parts: [{ text: cheapPrompt }] }],
          });
          fullResponse = result.text || "No pude generar una respuesta util esta vez.";
          setCachedCheapScoutResponse(userId, message, fullResponse);
          res.write(`data: ${JSON.stringify({ content: fullResponse, modelRoute, compactContext: true })}\n\n`);
          const usage = (result as any).usageMetadata || {};
          const inputTokens = Number(usage.promptTokenCount || usage.inputTokenCount || estimateTokensFromText(cheapPrompt));
          const outputTokens = Number(usage.candidatesTokenCount || usage.outputTokenCount || estimateTokensFromText(fullResponse));
          const estimatedCostUsd = estimateTokenApiCostUsd({
            provider: "gemini",
            model: geminiModel,
            inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
            outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
          });
          const notice = await recordAiApiCostEvent({
            userId,
            provider: "gemini",
            model: geminiModel,
            operation: "respuesta cheap scout del chat",
            estimatedCostUsd,
            metadata: {
              inputTokens,
              outputTokens,
              totalTokens: usage.totalTokenCount || null,
              modelRoute,
            },
          });
          if (notice) {
            res.write(`data: ${JSON.stringify({ content: `\n\n${notice}`, apiCostNotice: true, estimatedApiCostUsd: estimatedCostUsd })}\n\n`);
          }
        }
      } else {
        const maxCompletionTokens = getOpenAiMaxCompletionTokens();
        const previewCostUsd = estimateTokenApiCostUsd({
          provider: "openai",
          model: OPENAI_ASSISTANT_MODEL,
          inputTokens: estimateTokensFromText(JSON.stringify(openAiMessages)),
          outputTokens: maxCompletionTokens,
        });
        res.write(`data: ${JSON.stringify({
          content: `${formatAiApiCostPreview("openai", OPENAI_ASSISTANT_MODEL, "respuesta fuerte del chat", previewCostUsd)}\n\n`,
          apiCostPreview: true,
          estimatedApiCostUsd: previewCostUsd,
          modelRoute,
        })}\n\n`);
        const stream = await getOpenAIClient().chat.completions.create({
          model: OPENAI_ASSISTANT_MODEL,
          messages: openAiMessages,
          stream: true as const,
          max_completion_tokens: maxCompletionTokens,
          stream_options: { include_usage: true },
        });

        let openAiUsage: any = null;
        for await (const chunk of stream) {
          if ((chunk as any).usage) {
            openAiUsage = (chunk as any).usage;
          }
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            fullResponse += content;
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        }
        const inputTokens = Number(openAiUsage?.prompt_tokens || estimateTokensFromText(JSON.stringify(openAiMessages)));
        const outputTokens = Number(openAiUsage?.completion_tokens || estimateTokensFromText(fullResponse));
        const estimatedCostUsd = estimateTokenApiCostUsd({
          provider: "openai",
          model: OPENAI_ASSISTANT_MODEL,
          inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
          outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
        });
        const notice = await recordAiApiCostEvent({
          userId,
          provider: "openai",
          model: OPENAI_ASSISTANT_MODEL,
          operation: "respuesta fuerte del chat",
          estimatedCostUsd,
          metadata: {
            inputTokens,
            outputTokens,
            totalTokens: openAiUsage?.total_tokens || null,
            modelRoute,
          },
        });
        if (notice) {
          res.write(`data: ${JSON.stringify({ content: `\n\n${notice}`, apiCostNotice: true, estimatedApiCostUsd: estimatedCostUsd })}\n\n`);
        }
      }

      const promoVideoGenerateRegex = /\[PROMO_VIDEO_GENERATE:\s*(\{[^}]+\})\]/g;
      let promoVideoGenerateMatch;
      while ((promoVideoGenerateMatch = promoVideoGenerateRegex.exec(fullResponse)) !== null) {
        try {
          const promoData = JSON.parse(promoVideoGenerateMatch[1]);
          const generated = await executePromoVideoGenerateData(promoData, userId);
          res.write(`data: ${JSON.stringify({
            content: `\n\n${generated.summary}`,
            promoVideosGenerated: true,
            outputDir: generated.outputDir,
            outputVideos: generated.outputVideos,
            driveUploads: generated.driveUploads,
          })}\n\n`);
        } catch (e: any) {
          console.error("Error generating promo videos from assistant:", e);
          if (e instanceof PromoVideoSourceError) {
            res.write(`data: ${JSON.stringify({
              content: `\n\n${formatPromoVideoSourceQuestion(e)}`,
              promoVideoNeedsSourceConfirmation: true,
              suggestions: e.suggestions,
            })}\n\n`);
            continue;
          }
          res.write(`data: ${JSON.stringify({
            promoVideoError: e.message || "No pude generar los videos de promo",
          })}\n\n`);
        }
      }

      const radioYoutubeRegex = /\[RADIO_YOUTUBE_CLIPS:\s*(\{[^}]+\})\]/g;
      let radioYoutubeMatch;
      while ((radioYoutubeMatch = radioYoutubeRegex.exec(fullResponse)) !== null) {
        try {
          if (!isOwnerUser) {
            writeOwnerOnlySharedConnectorBlock(res, "YouTube, Google Drive y clips de radio");
            continue;
          }
          const radioYoutubeData = JSON.parse(radioYoutubeMatch[1]);
          const stopStatusHeartbeat = startAssistantStatusHeartbeat(res, RADIO_YOUTUBE_STATUS_MESSAGE);
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
          }, userId).finally(stopStatusHeartbeat);
          const summary = formatRadioYoutubeResult(result);
          if (result.status === "failed") {
            writeAssistantSse(res, { radioYoutubeError: summary });
          } else {
            writeAssistantSse(res, {
              content: `\n\n${summary}`,
              radioYoutubeProcessed: result.status === "completed",
              radioYoutubeNeedsConfirmation: result.status === "queued",
              radioYoutubeNeedsDjName: result.status === "needs_dj_name",
              pendingActionId: result.pendingActionId,
              driveFolderPath: result.driveFolderPath,
              clips: result.clips,
            });
          }
        } catch (e: any) {
          writeAssistantSse(res, {
            radioYoutubeError: withRadioEditEstimatedCost(e.message || "No pude procesar el link de YouTube para radio"),
          });
        }
      }

      const radioDriveVideoRegex = /\[RADIO_DRIVE_VIDEO_CLIPS:\s*(\{[^}]+\})\]/g;
      let radioDriveVideoMatch;
      while ((radioDriveVideoMatch = radioDriveVideoRegex.exec(fullResponse)) !== null) {
        try {
          if (!isOwnerUser) {
            writeOwnerOnlySharedConnectorBlock(res, "Google Drive/radio video");
            continue;
          }
          const radioDriveVideoData = JSON.parse(radioDriveVideoMatch[1]);
          const stopStatusHeartbeat = startAssistantStatusHeartbeat(res, RADIO_DRIVE_VIDEO_STATUS_MESSAGE);
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
          }, userId).finally(stopStatusHeartbeat);
          const summary = formatRadioDriveVideoResult(result);
          if (result.status === "failed") {
            writeAssistantSse(res, { radioDriveVideoError: summary });
          } else {
            writeAssistantSse(res, {
              content: `\n\n${summary}`,
              radioDriveVideoProcessed: result.status === "completed",
              radioDriveVideoNeedsConfirmation: result.status === "queued",
              radioDriveVideoNeedsDjName: result.status === "needs_dj_name",
              pendingActionId: result.pendingActionId,
              driveFolderPath: result.driveFolderPath,
              clips: result.clips,
            });
          }
        } catch (e: any) {
          writeAssistantSse(res, {
            radioDriveVideoError: withRadioEditEstimatedCost(e.message || "No pude procesar el MP4 de Google Drive para radio"),
          });
        }
      }

      const googleDriveCreateFolderRegex = /\[GOOGLE_DRIVE_CREATE_FOLDER:\s*(\{[^}]+\})\]/g;
      let googleDriveCreateFolderMatch;
      while ((googleDriveCreateFolderMatch = googleDriveCreateFolderRegex.exec(fullResponse)) !== null) {
        try {
          if (!isOwnerUser) {
            writeOwnerOnlySharedConnectorBlock(res, "Google Drive");
            continue;
          }
          const driveData = JSON.parse(googleDriveCreateFolderMatch[1]);
          const result = await createGoogleDriveFolderPath({
            userId,
            driveFolderPath: driveData.driveFolderPath,
            origin: "web",
          });
          res.write(`data: ${JSON.stringify({
            content: `\n\n${formatGoogleDriveFolderCreateResult(result)}`,
            googleDriveFolderCreated: true,
            driveFolder: result,
          })}\n\n`);
        } catch (e: any) {
          res.write(`data: ${JSON.stringify({
            googleDriveFolderError: e.message || "No pude crear la carpeta en Google Drive",
          })}\n\n`);
        }
      }

      const taskMatch = fullResponse.match(/\[CREAR_TAREA:\s*(\{[^}]+\})\]/);
      if (taskMatch) {
        try {
          const taskData = JSON.parse(taskMatch[1]);
          const newTask = await storage.createTask(userId, {
            title: taskData.title,
            date: new Date(taskData.date),
            priority: taskData.priority || "normal",
            type: "task",
            completed: false,
          });
          await writeAuditLog({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            actionType: "task.create",
            resourceType: "task",
            resourceId: newTask.id,
            metadata: taskData,
            status: "succeeded",
            executionMode: "user_requested",
          });
          res.write(`data: ${JSON.stringify({ taskCreated: newTask })}\n\n`);
        } catch (e) {
          console.error("Error creating task from assistant:", e);
        }
      }

      const followUpRegex = /\[CREAR_FOLLOWUP:\s*(\{[^}]+\})\]/g;
      let followUpMatch;
      while ((followUpMatch = followUpRegex.exec(fullResponse)) !== null) {
        try {
          const followUpData = JSON.parse(followUpMatch[1]);
          const date = followUpData.date ? new Date(followUpData.date) : new Date(Date.now() + 24 * 60 * 60 * 1000);
          const description = [
            `Owner: ${followUpData.person}`,
            followUpData.channel ? `Channel: ${followUpData.channel}` : null,
            followUpData.notes ? `Notes: ${followUpData.notes}` : null,
          ].filter(Boolean).join("\n");
          const newTask = await storage.createTask(userId, {
            title: `Follow-up: ${followUpData.person} - ${followUpData.topic}`,
            description,
            date,
            priority: followUpData.priority || "normal",
            type: "follow_up",
            completed: false,
          });
          await writeAuditLog({
            userId,
            actorType: "assistant",
            actorId: "web-assistant",
            origin: "web",
            actionType: "follow_up.create",
            resourceType: "task",
            resourceId: newTask.id,
            metadata: followUpData,
            status: "succeeded",
            executionMode: "user_requested",
          });
          res.write(`data: ${JSON.stringify({ followUpCreated: newTask })}\n\n`);
        } catch (e) {
          console.error("Error creating follow-up from assistant:", e);
        }
      }

      const radioMatch = fullResponse.match(/\[MODIFICAR_RADIO:\s*(\{[^}]+\})\]/);
      if (radioMatch) {
        try {
          if (!isOwnerUser) {
            writeOwnerOnlySharedConnectorBlock(res, "Google Calendar");
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();
            return;
          }
          const radioData = JSON.parse(radioMatch[1]);
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "calendar.modify_radio",
            resourceType: "calendar_event",
            resourceId: radioData.eventId,
            title: "Modificar evento de Radio",
            description: "El asistente quiere actualizar DJs/slots en un evento de Google Calendar.",
            input: radioData,
            proposedChanges: { description: radioData.description },
          });
          const execution = await executeIfAlreadyApproved(pendingAction, userId, message);
          if (execution.executed) {
            res.write(`data: ${JSON.stringify({ actionExecuted: true, title: pendingAction.title })}\n\n`);
          } else if (execution.error) {
            res.write(`data: ${JSON.stringify({ radioError: execution.error })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          }
        } catch (e) {
          console.error("Error updating radio from assistant:", e);
          res.write(`data: ${JSON.stringify({ radioError: "No se pudo actualizar el evento de Radio" })}\n\n`);
        }
      }

      const googleEventMatch = fullResponse.match(/\[CREAR_EVENTO_GOOGLE:\s*(\{[^}]+\})\]/);
      if (googleEventMatch) {
        try {
          if (!isOwnerUser) {
            writeOwnerOnlySharedConnectorBlock(res, "Google Calendar");
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();
            return;
          }
          const eventData = JSON.parse(googleEventMatch[1]);
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "calendar.create_event",
            resourceType: "calendar_event",
            title: `Crear evento: ${eventData.title}`,
            description: "El asistente quiere crear un evento en Google Calendar.",
            input: eventData,
            proposedChanges: eventData,
          });
          const execution = await executeIfAlreadyApproved(pendingAction, userId, message);
          if (execution.executed) {
            res.write(`data: ${JSON.stringify({ actionExecuted: true, title: pendingAction.title })}\n\n`);
          } else if (execution.error) {
            res.write(`data: ${JSON.stringify({ googleEventError: execution.error })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          }
        } catch (e) {
          console.error("Error creating Google Calendar event from assistant:", e);
          res.write(`data: ${JSON.stringify({ googleEventError: "No se pudo crear el evento en Google Calendar" })}\n\n`);
        }
      }

      const editGoogleEventRegex = /\[EDITAR_EVENTO_GOOGLE:\s*(\{[^}]+\})\]/g;
      let editGoogleEventMatch;
      while ((editGoogleEventMatch = editGoogleEventRegex.exec(fullResponse)) !== null) {
        try {
          if (!isOwnerUser) {
            writeOwnerOnlySharedConnectorBlock(res, "Google Calendar");
            continue;
          }
          const eventData = JSON.parse(editGoogleEventMatch[1]);
          if (!eventData.eventId) {
            res.write(`data: ${JSON.stringify({ googleEventError: "Falta eventId para editar el evento" })}\n\n`);
            continue;
          }
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "calendar.update_event",
            resourceType: "calendar_event",
            resourceId: eventData.eventId,
            title: `Editar evento: ${eventData.title || eventData.eventId}`,
            description: "El asistente quiere editar un evento existente de Google Calendar.",
            input: eventData,
            proposedChanges: eventData,
          });
          const execution = await executeIfAlreadyApproved(pendingAction, userId, message);
          if (execution.executed) {
            res.write(`data: ${JSON.stringify({ actionExecuted: true, title: pendingAction.title })}\n\n`);
          } else if (execution.error) {
            res.write(`data: ${JSON.stringify({ googleEventError: execution.error })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          }
        } catch (e) {
          console.error("Error editing Google Calendar event from assistant:", e);
          res.write(`data: ${JSON.stringify({ googleEventError: "No se pudo editar el evento en Google Calendar" })}\n\n`);
        }
      }

      const decisionRegex = /\[GUARDAR_DECISION:\s*(\{[^}]+\})\]/g;
      let decisionMatch;
      while ((decisionMatch = decisionRegex.exec(fullResponse)) !== null) {
        try {
          const decisionData = JSON.parse(decisionMatch[1]);
          const value = decisionData.context ? `${decisionData.decision}\nContext: ${decisionData.context}` : decisionData.decision;
          const decision = await storage.saveUserProfileData(userId, {
            userId,
            category: "decision",
            key: decisionData.title,
            value,
            confidence: "confirmed",
            source: "web-assistant",
          });
          await writeAuditLog({
            userId,
            actorType: "assistant",
            actorId: "web-assistant",
            origin: "web",
            actionType: "decision.save",
            resourceType: "user_profile_data",
            resourceId: decision.id,
            metadata: decisionData,
            status: "succeeded",
            executionMode: "user_requested",
          });
          res.write(`data: ${JSON.stringify({ decisionSaved: true, title: decisionData.title })}\n\n`);
        } catch (e) {
          console.error("Error saving decision from assistant:", e);
        }
      }

      const personRegex = /\[GUARDAR_PERSONA:\s*(\{[^}]+\})\]/g;
      let personMatch;
      while ((personMatch = personRegex.exec(fullResponse)) !== null) {
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
            source: "web-assistant",
          });
          await writeAuditLog({
            userId,
            actorType: "assistant",
            actorId: "web-assistant",
            origin: "web",
            actionType: "person.save",
            resourceType: "user_profile_data",
            resourceId: person.id,
            metadata: personData,
            status: "succeeded",
            executionMode: "user_requested",
          });
          res.write(`data: ${JSON.stringify({ personSaved: true, name: personData.name })}\n\n`);
        } catch (e) {
          console.error("Error saving person from assistant:", e);
        }
      }

      const commitmentRegex = /\[GUARDAR_COMPROMISO:\s*(\{[^}]+\})\]/g;
      let commitmentMatch;
      while ((commitmentMatch = commitmentRegex.exec(fullResponse)) !== null) {
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
            source: "web-assistant",
          });
          await writeAuditLog({
            userId,
            actorType: "assistant",
            actorId: "web-assistant",
            origin: "web",
            actionType: "commitment.save",
            resourceType: "user_profile_data",
            resourceId: commitment.id,
            metadata: commitmentData,
            status: "succeeded",
            executionMode: "user_requested",
          });
          res.write(`data: ${JSON.stringify({ commitmentSaved: true, owner: commitmentData.owner })}\n\n`);
        } catch (e) {
          console.error("Error saving commitment from assistant:", e);
        }
      }

      const communicationDraftRegex = /\[CREAR_BORRADOR_COMUNICACION:\s*(\{[^}]+\})\]/g;
      let communicationDraftMatch;
      while ((communicationDraftMatch = communicationDraftRegex.exec(fullResponse)) !== null) {
        try {
          const draftData = JSON.parse(communicationDraftMatch[1]);
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "web-assistant",
            origin: "web",
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
          res.write(`data: ${JSON.stringify({ communicationDraftCreated: true, pendingActionId: pendingAction.id })}\n\n`);
        } catch (e) {
          console.error("Error creating communication draft from assistant:", e);
        }
      }

      const metricoolAutomationRegex = /\[METRICOOL_AUTOMATION:\s*(\{[^}]+\})\]/g;
      let metricoolAutomationMatch;
      while ((metricoolAutomationMatch = metricoolAutomationRegex.exec(fullResponse)) !== null) {
        try {
          const metricoolData = sanitizeMetricoolAutomationInput(JSON.parse(metricoolAutomationMatch[1]));
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "web-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "marketing.metricool_automation",
            resourceType: "metricool_execution_queue",
            title: metricoolData.publishMode === "auto_after_connection"
              ? "Preparar Metricool auto publish"
              : "Preparar cola Metricool",
            description: buildMetricoolPendingDescription(metricoolData),
            input: metricoolData,
            proposedChanges: {
              publishMode: metricoolData.publishMode,
              clipsPerAccount: metricoolData.clipsPerAccount,
              riskTolerance: metricoolData.riskTolerance,
              platforms: metricoolData.platforms,
              campaign: metricoolData.campaign,
            },
          });
          const execution = await executeIfAlreadyApproved(pendingAction, userId, message);
          if (execution.executed) {
            res.write(`data: ${JSON.stringify({ actionExecuted: true, title: pendingAction.title, metricoolAutomationQueued: true })}\n\n`);
          } else if (execution.error) {
            res.write(`data: ${JSON.stringify({ metricoolAutomationError: execution.error })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction, metricoolAutomationPending: true })}\n\n`);
          }
        } catch (e: any) {
          console.error("Error creating Metricool automation pending action:", e);
          res.write(`data: ${JSON.stringify({ metricoolAutomationError: e.message || "No pude preparar Metricool" })}\n\n`);
        }
      }

      const blackRoomPerformanceRegex = /\[BLACKROOM_LINK_PERFORMANCE:\s*(\{[^}]+\})\]/g;
      let blackRoomPerformanceMatch;
      while ((blackRoomPerformanceMatch = blackRoomPerformanceRegex.exec(fullResponse)) !== null) {
        try {
          const performanceData = JSON.parse(blackRoomPerformanceMatch[1]);
          const performance = await getBlackRoomLinkPerformance({
            id: performanceData.id || null,
            title: performanceData.title || null,
            url: performanceData.url || null,
            limit: performanceData.limit || 10,
          });
          const summary = formatBlackRoomLinkPerformance(performance);
          res.write(`data: ${JSON.stringify({ content: `\n\n${summary}` })}\n\n`);
        } catch (e: any) {
          console.error("Error reading Black Room link performance:", e);
          res.write(`data: ${JSON.stringify({ blackRoomLinkError: e.message || "No pude leer el rendimiento de los links de Black Room" })}\n\n`);
        }
      }

      const blackRoomTimerAddRegex = /\[BLACKROOM_TIMER_ADD:\s*(\{[^}]+\})\]/g;
      let blackRoomTimerAddMatch;
      while ((blackRoomTimerAddMatch = blackRoomTimerAddRegex.exec(fullResponse)) !== null) {
        try {
          const timerData = JSON.parse(blackRoomTimerAddMatch[1]);
          if (!timerData.title && !timerData.partyTitle) {
            throw new Error("Falta title o partyTitle para saber a qué fiesta agregarle el timer.");
          }
          const input = {
            title: timerData.title || null,
            partyTitle: timerData.partyTitle || timerData.matchTitle || null,
            date: timerData.date || timerData.targetDate || null,
            targetDate: timerData.targetDate || timerData.date || null,
            url: timerData.url || null,
          };
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "marketing.blackroom_timer_add",
            resourceType: "blackroom_timer",
            title: `Agregar timer Black Room: ${input.title || input.partyTitle}`,
            description: "El asistente quiere agregar un countdown/timer en el builder de Black Room.",
            input,
            proposedChanges: input,
          });
          const execution = await executeIfAlreadyApproved(pendingAction, userId, message);
          if (execution.executed) {
            res.write(`data: ${JSON.stringify({ actionExecuted: true, title: pendingAction.title })}\n\n`);
          } else if (execution.error) {
            res.write(`data: ${JSON.stringify({ blackRoomLinkError: execution.error })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          }
        } catch (e: any) {
          console.error("Error creating Black Room timer pending action:", e);
          res.write(`data: ${JSON.stringify({ blackRoomLinkError: e.message || "No se pudo preparar el timer de Black Room" })}\n\n`);
        }
      }

      const blackRoomAddRegex = /\[BLACKROOM_LINK_ADD:\s*(\{[^}]+\})\]/g;
      let blackRoomAddMatch;
      while ((blackRoomAddMatch = blackRoomAddRegex.exec(fullResponse)) !== null) {
        try {
          const linkData = JSON.parse(blackRoomAddMatch[1]);
          const title = requireStringField(linkData, "title", "title para el link");
          const url = requireStringField(linkData, "url", "url para el link");
          const input = {
            title,
            subtitle: linkData.subtitle || null,
            url,
            icon: linkData.icon || "link",
            display_order: linkData.display_order ?? null,
            builderStyle: linkData.builderStyle || "filled",
            builderColor: linkData.builderColor || "#1a1a1a",
          };
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "marketing.blackroom_link_add",
            resourceType: "blackroom_link",
            title: `Agregar link Black Room: ${title}`,
            description: "El asistente quiere agregar un link en link-stats y en el builder de Black Room.",
            input,
            proposedChanges: input,
          });
          const execution = await executeIfAlreadyApproved(pendingAction, userId, message);
          if (execution.executed) {
            res.write(`data: ${JSON.stringify({ actionExecuted: true, title: pendingAction.title })}\n\n`);
          } else if (execution.error) {
            res.write(`data: ${JSON.stringify({ blackRoomLinkError: execution.error })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          }
        } catch (e: any) {
          console.error("Error creating Black Room link pending action:", e);
          res.write(`data: ${JSON.stringify({ blackRoomLinkError: e.message || "No se pudo preparar el link de Black Room" })}\n\n`);
        }
      }

      const blackRoomUpdateRegex = /\[BLACKROOM_LINK_UPDATE:\s*(\{[^}]+\})\]/g;
      let blackRoomUpdateMatch;
      while ((blackRoomUpdateMatch = blackRoomUpdateRegex.exec(fullResponse)) !== null) {
        try {
          const linkData = JSON.parse(blackRoomUpdateMatch[1]);
          const title = (
            typeof linkData.title === "string" && linkData.title.trim()
              ? linkData.title.trim()
              : typeof linkData.matchTitle === "string" && linkData.matchTitle.trim()
                ? linkData.matchTitle.trim()
                : ""
          );
          if (!title) {
            throw new Error("Falta title o matchTitle para el link");
          }
          const url = requireStringField(linkData, "url", "url nueva para el link");
          if (!linkData.matchTitle && !linkData.matchUrl && !linkData.matchId) {
            throw new Error("Falta matchTitle, matchUrl o matchId para saber cuál link editar.");
          }
          const input = {
            matchId: linkData.matchId || null,
            matchTitle: linkData.matchTitle || null,
            matchUrl: linkData.matchUrl || null,
            title,
            subtitle: linkData.subtitle || null,
            url,
            icon: linkData.icon || "link",
            display_order: linkData.display_order ?? null,
            builderStyle: linkData.builderStyle || "filled",
            builderColor: linkData.builderColor || "#1a1a1a",
          };
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "marketing.blackroom_link_update",
            resourceType: "blackroom_link",
            resourceId: String(input.matchId || input.matchUrl || input.matchTitle),
            title: `Editar link Black Room: ${title}`,
            description: "El asistente quiere editar un link existente en link-stats y en el builder de Black Room.",
            input,
            proposedChanges: input,
          });
          const execution = await executeIfAlreadyApproved(pendingAction, userId, message);
          if (execution.executed) {
            res.write(`data: ${JSON.stringify({ actionExecuted: true, title: pendingAction.title })}\n\n`);
          } else if (execution.error) {
            res.write(`data: ${JSON.stringify({ blackRoomLinkError: execution.error })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          }
        } catch (e: any) {
          console.error("Error updating Black Room link pending action:", e);
          res.write(`data: ${JSON.stringify({ blackRoomLinkError: e.message || "No se pudo preparar la edición del link de Black Room" })}\n\n`);
        }
      }

      const blackRoomDeactivateRegex = /\[BLACKROOM_LINK_DEACTIVATE:\s*(\{[^}]+\})\]/g;
      let blackRoomDeactivateMatch;
      while ((blackRoomDeactivateMatch = blackRoomDeactivateRegex.exec(fullResponse)) !== null) {
        try {
          const linkData = JSON.parse(blackRoomDeactivateMatch[1]);
          if (!linkData.title && !linkData.url && !linkData.id) {
            throw new Error("Falta title, url o id para saber cuál link desactivar.");
          }
          const input = {
            id: linkData.id || null,
            title: linkData.title || null,
            url: linkData.url || null,
            reason: linkData.reason || "Desactivar link preservando data histórica.",
          };
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "marketing.blackroom_link_deactivate",
            resourceType: "blackroom_link",
            resourceId: String(input.id || input.url || input.title),
            title: `Desactivar link Black Room: ${input.title || input.url || input.id}`,
            description: "El asistente quiere desactivar un link de Black Room sin borrar su data histórica.",
            input,
            proposedChanges: { ...input, is_active: false, delete: false, preserveHistoricalData: true },
          });
          const execution = await executeIfAlreadyApproved(pendingAction, userId, message);
          if (execution.executed) {
            res.write(`data: ${JSON.stringify({ actionExecuted: true, title: pendingAction.title })}\n\n`);
          } else if (execution.error) {
            res.write(`data: ${JSON.stringify({ blackRoomLinkError: execution.error })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          }
        } catch (e: any) {
          console.error("Error deactivating Black Room link pending action:", e);
          res.write(`data: ${JSON.stringify({ blackRoomLinkError: e.message || "No se pudo preparar la desactivación del link de Black Room" })}\n\n`);
        }
      }

      // Process multiple GUARDAR_INFO commands
      const infoRegex = /\[GUARDAR_INFO:\s*(\{[^}]+\})\]/g;
      let infoMatch;
      while ((infoMatch = infoRegex.exec(fullResponse)) !== null) {
        try {
          const infoData = JSON.parse(infoMatch[1]);
          await storage.saveUserProfileData(userId, {
            userId,
            category: infoData.category,
            key: infoData.key,
            value: infoData.value,
            confidence: "confirmed",
            source: "conversation",
          });
          await writeAuditLog({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            actionType: "memory.save",
            resourceType: "user_profile_data",
            metadata: infoData,
            status: "succeeded",
            executionMode: "user_requested",
          });
          res.write(`data: ${JSON.stringify({ infoSaved: true, key: infoData.key })}\n\n`);
        } catch (e) {
          console.error("Error saving user info from assistant:", e);
        }
      }

      // Process multiple AGREGAR_INVERSION commands
      const addInvestmentRegex = /\[AGREGAR_INVERSION:\s*(\{[^}]+\})\]/g;
      let addInvMatch;
      while ((addInvMatch = addInvestmentRegex.exec(fullResponse)) !== null) {
        try {
          const invData = JSON.parse(addInvMatch[1]);
          if (!invData.symbol || !invData.name || !invData.type || !invData.quantity || !invData.avgBuyPrice) {
            res.write(`data: ${JSON.stringify({ investmentError: "Faltan campos requeridos para agregar inversión" })}\n\n`);
            continue;
          }
          const validTypes = ["stock", "etf", "crypto", "bond", "fund"];
          if (!validTypes.includes(invData.type)) {
            res.write(`data: ${JSON.stringify({ investmentError: `Tipo inválido: ${invData.type}. Usa: ${validTypes.join(", ")}` })}\n\n`);
            continue;
          }
          const pendingAction = await createPendingActionForApproval({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            executionMode: "user_requested",
            actionType: "finance.create_investment",
            resourceType: "investment",
            title: `Agregar inversión: ${String(invData.symbol).toUpperCase()}`,
            description: "El asistente quiere agregar una inversión al portafolio.",
            input: {
            symbol: invData.symbol.toUpperCase(),
            name: invData.name,
            type: invData.type,
            quantity: String(invData.quantity),
            avgBuyPrice: String(invData.avgBuyPrice),
            currency: "USD",
            },
            proposedChanges: invData,
          });
          res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
        } catch (e) {
          console.error("Error creating investment from assistant:", e);
          res.write(`data: ${JSON.stringify({ investmentError: "No se pudo agregar la inversión" })}\n\n`);
        }
      }

      // Process multiple ACTUALIZAR_INVERSION commands
      const updateInvestmentRegex = /\[ACTUALIZAR_INVERSION:\s*(\{[^}]+\})\]/g;
      let updateInvMatch;
      const investmentsCache = await storage.getInvestments(userId);
      while ((updateInvMatch = updateInvestmentRegex.exec(fullResponse)) !== null) {
        try {
          const invData = JSON.parse(updateInvMatch[1]);
          if (!invData.symbol) {
            res.write(`data: ${JSON.stringify({ investmentError: "Se requiere el símbolo para actualizar" })}\n\n`);
            continue;
          }
          const existing = investmentsCache.find(i => i.symbol.toUpperCase() === invData.symbol.toUpperCase());
          if (existing) {
            const updates: { quantity?: string; avgBuyPrice?: string } = {};
            if (invData.quantity !== undefined) updates.quantity = String(invData.quantity);
            if (invData.avgBuyPrice !== undefined) updates.avgBuyPrice = String(invData.avgBuyPrice);
            const pendingAction = await createPendingActionForApproval({
              userId,
              actorType: "assistant",
              actorId: "blackops-assistant",
              origin: "web",
              executionMode: "user_requested",
              actionType: "finance.update_investment",
              resourceType: "investment",
              resourceId: existing.id,
              title: `Actualizar inversión: ${invData.symbol.toUpperCase()}`,
              description: "El asistente quiere modificar datos del portafolio.",
              input: { symbol: invData.symbol.toUpperCase(), ...updates },
              proposedChanges: updates,
            });
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ investmentError: `No se encontró inversión con símbolo ${invData.symbol}` })}\n\n`);
          }
        } catch (e) {
          console.error("Error updating investment from assistant:", e);
          res.write(`data: ${JSON.stringify({ investmentError: "No se pudo actualizar la inversión" })}\n\n`);
        }
      }

      // Process multiple ELIMINAR_INVERSION commands
      const deleteInvestmentRegex = /\[ELIMINAR_INVERSION:\s*(\{[^}]+\})\]/g;
      let deleteInvMatch;
      while ((deleteInvMatch = deleteInvestmentRegex.exec(fullResponse)) !== null) {
        try {
          const invData = JSON.parse(deleteInvMatch[1]);
          if (!invData.symbol) {
            res.write(`data: ${JSON.stringify({ investmentError: "Se requiere el símbolo para eliminar" })}\n\n`);
            continue;
          }
          const existing = investmentsCache.find(i => i.symbol.toUpperCase() === invData.symbol.toUpperCase());
          if (existing) {
            const pendingAction = await createPendingActionForApproval({
              userId,
              actorType: "assistant",
              actorId: "blackops-assistant",
              origin: "web",
              executionMode: "user_requested",
              actionType: "finance.delete_investment",
              resourceType: "investment",
              resourceId: existing.id,
              title: `Eliminar inversión: ${invData.symbol.toUpperCase()}`,
              description: "El asistente quiere eliminar una inversión del portafolio.",
              input: { symbol: invData.symbol.toUpperCase() },
              proposedChanges: { delete: true, symbol: invData.symbol.toUpperCase() },
            });
            res.write(`data: ${JSON.stringify({ approvalRequired: true, pendingAction })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ investmentError: `No se encontró inversión con símbolo ${invData.symbol}` })}\n\n`);
          }
        } catch (e) {
          console.error("Error deleting investment from assistant:", e);
          res.write(`data: ${JSON.stringify({ investmentError: "No se pudo eliminar la inversión" })}\n\n`);
        }
      }

      // Process CREAR_RECORDATORIO commands
      const createReminderRegex = /\[CREAR_RECORDATORIO:\s*(\{[^}]+\})\]/g;
      let createReminderMatch;
      while ((createReminderMatch = createReminderRegex.exec(fullResponse)) !== null) {
        try {
          const reminderData = JSON.parse(createReminderMatch[1]);
          if (!reminderData.message || reminderData.hour === undefined) {
            res.write(`data: ${JSON.stringify({ reminderError: "Se requiere mensaje y hora para el recordatorio" })}\n\n`);
            continue;
          }
          const hour = parseInt(reminderData.hour);
          const minute = parseInt(reminderData.minute || 0);
          if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            res.write(`data: ${JSON.stringify({ reminderError: "Hora inválida. Usa formato 24h (0-23)" })}\n\n`);
            continue;
          }
          const reminder = await storage.createScheduledReminder(userId, {
            message: reminderData.message,
            hour,
            minute,
            daysOfWeek: reminderData.daysOfWeek || null,
            isActive: true,
          });
          await writeAuditLog({
            userId,
            actorType: "assistant",
            actorId: "blackops-assistant",
            origin: "web",
            actionType: "reminder.create",
            resourceType: "scheduled_reminder",
            resourceId: reminder.id,
            metadata: reminderData,
            status: "succeeded",
            executionMode: "user_requested",
          });
          const daysText = reminderData.daysOfWeek?.length > 0 
            ? reminderData.daysOfWeek.join(", ") 
            : "todos los días";
          res.write(`data: ${JSON.stringify({ reminderCreated: true, message: reminderData.message, time: `${hour}:${String(minute).padStart(2, '0')}`, days: daysText })}\n\n`);
        } catch (e) {
          console.error("Error creating reminder from assistant:", e);
          res.write(`data: ${JSON.stringify({ reminderError: "No se pudo crear el recordatorio" })}\n\n`);
        }
      }

      // Process ELIMINAR_RECORDATORIO commands
      const deleteReminderRegex = /\[ELIMINAR_RECORDATORIO:\s*(\{[^}]+\})\]/g;
      let deleteReminderMatch;
      while ((deleteReminderMatch = deleteReminderRegex.exec(fullResponse)) !== null) {
        try {
          const reminderData = JSON.parse(deleteReminderMatch[1]);
          if (!reminderData.id) {
            res.write(`data: ${JSON.stringify({ reminderError: "Se requiere el ID del recordatorio" })}\n\n`);
            continue;
          }
          await storage.deleteScheduledReminder(reminderData.id);
          res.write(`data: ${JSON.stringify({ reminderDeleted: true, id: reminderData.id })}\n\n`);
        } catch (e) {
          console.error("Error deleting reminder from assistant:", e);
          res.write(`data: ${JSON.stringify({ reminderError: "No se pudo eliminar el recordatorio" })}\n\n`);
        }
      }

      if (!fullResponse.trim()) {
        fullResponse = "No pude generar una respuesta útil esta vez. Intenta reformularlo en una frase más concreta.";
        res.write(`data: ${JSON.stringify({ content: fullResponse })}\n\n`);
      }

      await saveCeoConversationMessage(userId, "assistant", fullResponse);

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error in assistant chat:", errorMessage, error);
      const userFacingError = `Error: ${errorMessage}`;
      if (requestUserId) {
        await saveCeoConversationMessage(requestUserId, "assistant", userFacingError).catch((historyError) => {
          console.error("Error saving assistant failure to shared history:", historyError);
        });
      }
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: userFacingError })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: errorMessage });
      }
    }
  });

  app.get("/api/assistant/context", async (req: Request, res: Response) => {
    try {
      const context = await getCalendarContext(getCurrentUserId(req));
      res.json({ context });
    } catch (error) {
      res.status(500).json({ error: "Failed to get context" });
    }
  });
}
