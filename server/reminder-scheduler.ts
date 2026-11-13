import { storage } from "./storage";
import { sendPushNotification } from "./push-notifications";
import { sendTelegramMessage, sendTelegramPlainMessageChunks } from "./telegram";
import { sendProactiveInsights } from "./proactive-insights";
import { executeAction, type AgentActionResult } from "./agent-actions";
import { getPortfolioNews, type NewsItem } from "./finance";
import { getSystemUserId } from "./user-context";
import { generateCeoMorningBrief } from "./ceo-briefing";
import { runDropshippingDailyOperatingCycle, sendDropshippingDailyReport } from "./dropshipping-ceo";
import { getExistingAutomations, recordScheduledAutomationRun, type ScheduledAutomationRunOutcome } from "./automation-registry";
import { generateRadioTemplatesForDate, type RadioTemplateRunResult } from "./radio-template-agent";
import { hasRealValue } from "./ceo-doctor-cli";
import {
  getDateKeyFromClock,
  getZonedClock as getClockInTimezone,
  shouldRunDailyScheduledJob,
  type SchedulerClock,
} from "./scheduler-time";

interface SchedulerPushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

interface ScheduledRunRecorderDeps {
  recordScheduledAutomationRun(
    userId: string,
    automationKey: string,
    startedAt: Date,
    outcome: ScheduledAutomationRunOutcome,
  ): Promise<unknown>;
  now(): Date;
}

interface NotificationDeliveryDeps {
  getScheduledNotificationUserIds(): Promise<string[]>;
  getTodaysTasks(userId: string): Promise<{ pending: string[]; completed: string[] }>;
  sendPushNotification(userId: string, payload: SchedulerPushPayload): Promise<unknown>;
  sendTelegramNotificationToUser(userId: string, title: string, body: string, plainText: boolean): Promise<boolean>;
}

export interface MorningReminderSchedulerDeps extends NotificationDeliveryDeps, ScheduledRunRecorderDeps {
  getScheduledNotificationUserIds(): Promise<string[]>;
  getTodaysTasks(userId: string): Promise<{ pending: string[]; completed: string[] }>;
  generateCeoMorningBrief(userId: string): Promise<string>;
  sendPushNotification(userId: string, payload: SchedulerPushPayload): Promise<unknown>;
  sendTelegramNotificationToUser(userId: string, title: string, body: string, plainText: boolean): Promise<boolean>;
}

export interface MorningReminderRunResult {
  userId: string;
  pendingCount: number;
}

export type EveningReminderSchedulerDeps = NotificationDeliveryDeps & ScheduledRunRecorderDeps;

export interface EveningReminderRunResult {
  userId: string;
  sent: boolean;
  pendingCount: number;
}

export interface WeeklyReminderSchedulerDeps extends ScheduledRunRecorderDeps {
  getScheduledNotificationUserIds(): Promise<string[]>;
  getIncompleteWeeklyTasks(userId: string): Promise<string[]>;
  sendPushNotification(userId: string, payload: SchedulerPushPayload): Promise<unknown>;
  sendTelegramNotificationToUser(userId: string, title: string, body: string, plainText: boolean): Promise<boolean>;
}

export interface WeeklyReminderRunResult {
  userId: string;
  sent: boolean;
  incompleteCount: number;
}

export interface UserScheduledReminderItem {
  id: string;
  userId: string;
  message: string;
  hour: number;
  minute: number;
  daysOfWeek?: string[] | null;
}

export interface UserScheduledReminderSchedulerDeps {
  getActiveScheduledReminders(): Promise<UserScheduledReminderItem[]>;
  getZonedClock(date: Date): SchedulerClock;
  sendTelegramNotificationToUser(userId: string, title: string, body: string, plainText: boolean): Promise<boolean>;
  sentReminderKeys: Map<string, string>;
}

export interface UserScheduledReminderRunResult {
  reminderId: string;
  userId: string;
  message: string;
  sent: boolean;
}

interface PortfolioInvestmentSymbol {
  symbol: string;
}

export interface NewsDigestSchedulerDeps {
  getInvestments(userId: string): Promise<PortfolioInvestmentSymbol[]>;
  getPortfolioNews(symbols: string[]): Promise<NewsItem[]>;
  sendTelegramNotificationToUser(userId: string, title: string, body: string, plainText: boolean): Promise<boolean>;
}

export interface NewsDigestRunResult {
  sent: boolean;
  newsCount: number;
}

export interface ProactiveInsightsRunResult {
  userId: string;
  sent: boolean;
  insights: number;
}

export interface ProactiveInsightsSchedulerDeps extends ScheduledRunRecorderDeps {
  getScheduledNotificationUserIds(): Promise<string[]>;
  sendProactiveInsights(userId: string): Promise<{ sent: boolean; insights: number }>;
}

export interface ScheduledAgentActionRunResult extends AgentActionResult {
  userId: string;
}

export interface ScheduledAgentActionDeps extends ScheduledRunRecorderDeps {
  getScheduledNotificationUserIds(): Promise<string[]>;
  executeAction(actionId: string, userId: string): Promise<AgentActionResult>;
}

interface RadioTemplateAutomationDefinition {
  id: string;
  costEstimate?: string | null;
  metadata?: unknown;
}

interface RadioTemplateAutomationRunInsert {
  automationId: string;
  ownerUserId: string;
  startedAt: Date;
  finishedAt: Date;
  status: "success" | "failed" | "skipped";
  triggeredBy: "scheduler";
  resultSummary: string;
  errorMessage: string | null;
  costEstimate?: string | null;
  pendingActionId: null;
  auditLogId: null;
  metadata: any;
}

export interface RadioTemplateGenerationDeps {
  ensureDefaultAutomations(userId: string): Promise<RadioTemplateAutomationDefinition[]>;
  generateRadioTemplatesForDate(userId: string): Promise<RadioTemplateRunResult>;
  createAutomationRun(run: RadioTemplateAutomationRunInsert): Promise<unknown>;
  now(): Date;
}

function parseScheduleNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function getReminderSchedulerConfig() {
  return {
    timezone: process.env.SCHEDULER_TIMEZONE || "America/New_York",
    ceoBriefHour: parseScheduleNumber(process.env.CEO_BRIEF_HOUR, 7, 0, 23),
    ceoBriefMinute: parseScheduleNumber(process.env.CEO_BRIEF_MINUTE, 0, 0, 59),
    insightsHour: parseScheduleNumber(process.env.INSIGHTS_HOUR, 8, 0, 23),
    newsDigestHour: parseScheduleNumber(process.env.NEWS_DIGEST_HOUR, 9, 0, 23),
    eveningReviewHour: parseScheduleNumber(process.env.EVENING_REVIEW_HOUR, 21, 0, 23),
    dropshippingCeoCycleHour: parseScheduleNumber(process.env.DROPSHIPPING_CEO_CYCLE_HOUR, 7, 0, 23),
    dropshippingCeoCycleMinute: parseScheduleNumber(process.env.DROPSHIPPING_CEO_CYCLE_MINUTE, 20, 0, 59),
    dropshippingCeoMorningHour: parseScheduleNumber(process.env.DROPSHIPPING_CEO_MORNING_HOUR, 7, 0, 23),
    dropshippingCeoMorningMinute: parseScheduleNumber(process.env.DROPSHIPPING_CEO_MORNING_MINUTE, 30, 0, 59),
    dropshippingCeoEveningHour: parseScheduleNumber(process.env.DROPSHIPPING_CEO_EVENING_HOUR, 21, 0, 23),
    dropshippingCeoEveningMinute: parseScheduleNumber(process.env.DROPSHIPPING_CEO_EVENING_MINUTE, 0, 0, 59),
  };
}

async function sendTelegramNotificationToUser(userId: string, title: string, body: string, plainText = false): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!hasRealValue(botToken)) return false;

  const config = await storage.getTelegramConfig(userId);
  if (!config || !config.enabled) return false;

  const message = `<b>${title}</b>\n\n${body}`;
  return plainText
    ? sendTelegramPlainMessageChunks(botToken, config.chatId, `${title}\n\n${body}`)
    : sendTelegramMessage(botToken, config.chatId, message);
}

async function getScheduledNotificationUserIds(): Promise<string[]> {
  const [telegramConfigs, pushSubscriptions] = await Promise.all([
    storage.getEnabledTelegramConfigs(),
    storage.getAllPushSubscriptions(),
  ]);
  const userIds = [
    ...telegramConfigs.map((config) => config.userId),
    ...pushSubscriptions.map((subscription) => subscription.userId),
  ].filter((userId): userId is string => Boolean(userId));
  const uniqueUserIds = Array.from(new Set(userIds));
  return uniqueUserIds.length ? uniqueUserIds : [getSystemUserId()];
}

export async function sendMorningReminderWithDeps(deps: MorningReminderSchedulerDeps): Promise<MorningReminderRunResult[]> {
  const title = "🌅 Brief CEO";
  const userIds = await deps.getScheduledNotificationUserIds();

  return Promise.all(userIds.map(async (userId) => {
    const startedAt = deps.now();
    try {
      const { pending } = await deps.getTodaysTasks(userId);
      const body = await deps.generateCeoMorningBrief(userId);

      await Promise.all([
        deps.sendPushNotification(userId, {
          title,
          body: pending.length > 0 ? `${pending.length} pendiente(s) para hoy.` : "Brief ejecutivo listo.",
          url: "/",
          tag: "morning-reminder",
        }),
        deps.sendTelegramNotificationToUser(userId, title, body, true),
      ]);

      const result = { userId, pendingCount: pending.length };
      await deps.recordScheduledAutomationRun(userId, "morning-reminder", startedAt, {
        status: "success",
        resultSummary: `CEO morning brief sent with ${result.pendingCount} pending task(s).`,
        metadata: { pendingCount: result.pendingCount },
      });
      return result;
    } catch (error: any) {
      const message = error?.message || "Scheduled automation failed";
      await deps.recordScheduledAutomationRun(userId, "morning-reminder", startedAt, {
        status: "failed",
        resultSummary: "morning-reminder failed",
        errorMessage: message,
        metadata: { error: message },
      });
      throw error;
    }
  }));
}

export async function sendEveningReminderWithDeps(deps: EveningReminderSchedulerDeps): Promise<EveningReminderRunResult[]> {
  const title = "🌙 Tareas sin Completar";
  const userIds = await deps.getScheduledNotificationUserIds();

  return Promise.all(userIds.map(async (userId) => {
    const startedAt = deps.now();
    try {
      const { pending } = await deps.getTodaysTasks(userId);

      if (pending.length === 0) {
        const result = { userId, sent: false, pendingCount: 0 };
        await deps.recordScheduledAutomationRun(userId, "evening-reminder", startedAt, {
          status: "skipped",
          resultSummary: "Evening reminder skipped because all tasks are complete.",
          metadata: { sent: false, pendingCount: 0 },
        });
        return result;
      }

      const taskList = pending.slice(0, 5).join("\n• ");
      const moreText = pending.length > 5 ? `\n+${pending.length - 5} más` : "";
      const body = `Quedan ${pending.length} tarea${pending.length > 1 ? "s" : ""} por hacer:\n• ${taskList}${moreText}`;

      await Promise.all([
        deps.sendPushNotification(userId, { title, body, url: "/", tag: "evening-reminder" }),
        deps.sendTelegramNotificationToUser(userId, title, body, true),
      ]);

      const result = { userId, sent: true, pendingCount: pending.length };
      await deps.recordScheduledAutomationRun(userId, "evening-reminder", startedAt, {
        status: "success",
        resultSummary: `Evening reminder sent with ${result.pendingCount} pending task(s).`,
        metadata: { sent: true, pendingCount: result.pendingCount },
      });
      return result;
    } catch (error: any) {
      const message = error?.message || "Scheduled automation failed";
      await deps.recordScheduledAutomationRun(userId, "evening-reminder", startedAt, {
        status: "failed",
        resultSummary: "evening-reminder failed",
        errorMessage: message,
        metadata: { error: message },
      });
      throw error;
    }
  }));
}

export async function sendWeeklyReminderWithDeps(deps: WeeklyReminderSchedulerDeps): Promise<WeeklyReminderRunResult[]> {
  const title = "📅 Tareas Semanales Pendientes";
  const userIds = await deps.getScheduledNotificationUserIds();

  return Promise.all(userIds.map(async (userId) => {
    const startedAt = deps.now();
    try {
      const incompleteTasks = await deps.getIncompleteWeeklyTasks(userId);

      if (incompleteTasks.length === 0) {
        const result = { userId, sent: false, incompleteCount: 0 };
        await deps.recordScheduledAutomationRun(userId, "weekly-reminder", startedAt, {
          status: "skipped",
          resultSummary: "Weekly reminder skipped because all weekly tasks are complete.",
          metadata: { sent: false, incompleteCount: 0 },
        });
        return result;
      }

      const taskList = incompleteTasks.slice(0, 5).join("\n• ");
      const moreText = incompleteTasks.length > 5 ? `\n+${incompleteTasks.length - 5} más` : "";
      const body = `Tienes ${incompleteTasks.length} tarea${incompleteTasks.length > 1 ? "s" : ""} semanal${incompleteTasks.length > 1 ? "es" : ""} pendiente${incompleteTasks.length > 1 ? "s" : ""}:\n• ${taskList}${moreText}`;

      await Promise.all([
        deps.sendPushNotification(userId, { title, body, url: "/", tag: "weekly-reminder" }),
        deps.sendTelegramNotificationToUser(userId, title, body, true),
      ]);

      const result = { userId, sent: true, incompleteCount: incompleteTasks.length };
      await deps.recordScheduledAutomationRun(userId, "weekly-reminder", startedAt, {
        status: "success",
        resultSummary: `Weekly reminder sent with ${result.incompleteCount} incomplete task(s).`,
        metadata: { sent: true, incompleteCount: result.incompleteCount },
      });
      return result;
    } catch (error: any) {
      const message = error?.message || "Scheduled automation failed";
      await deps.recordScheduledAutomationRun(userId, "weekly-reminder", startedAt, {
        status: "failed",
        resultSummary: "weekly-reminder failed",
        errorMessage: message,
        metadata: { error: message },
      });
      throw error;
    }
  }));
}

export async function sendProactiveInsightsWithDeps(
  deps: ProactiveInsightsSchedulerDeps,
): Promise<ProactiveInsightsRunResult[]> {
  const userIds = await deps.getScheduledNotificationUserIds();

  return Promise.all(userIds.map(async (userId) => {
    const startedAt = deps.now();
    try {
      const result = await deps.sendProactiveInsights(userId);
      await deps.recordScheduledAutomationRun(userId, "proactive-insights", startedAt, {
        status: result.sent ? "success" : "skipped",
        resultSummary: result.sent
          ? `Proactive insights sent with ${result.insights} insight(s).`
          : "Proactive insights skipped because nothing was sent.",
        metadata: result,
      });
      return { userId, ...result };
    } catch (error: any) {
      const message = error?.message || "Scheduled automation failed";
      await deps.recordScheduledAutomationRun(userId, "proactive-insights", startedAt, {
        status: "failed",
        resultSummary: "proactive-insights failed",
        errorMessage: message,
        metadata: { error: message },
      });
      throw error;
    }
  }));
}

export async function runScheduledAgentActionWithDeps(
  automationKey: string,
  actionId: string,
  deps: ScheduledAgentActionDeps,
): Promise<ScheduledAgentActionRunResult[]> {
  const userIds = await deps.getScheduledNotificationUserIds();

  return Promise.all(userIds.map(async (userId) => {
    const startedAt = deps.now();
    try {
      const result = await deps.executeAction(actionId, userId);
      await deps.recordScheduledAutomationRun(userId, automationKey, startedAt, {
        status: result.success ? "success" : "failed",
        resultSummary: result.message,
        errorMessage: result.success ? null : result.message,
        metadata: result,
      });
      return { userId, ...result };
    } catch (error: any) {
      const message = error?.message || "Scheduled automation failed";
      await deps.recordScheduledAutomationRun(userId, automationKey, startedAt, {
        status: "failed",
        resultSummary: `${automationKey} failed`,
        errorMessage: message,
        metadata: { error: message },
      });
      throw error;
    }
  }));
}

async function runTrackedScheduledAutomation<T>(
  userId: string,
  automationKey: string,
  run: () => Promise<T>,
  summarize: (result: T) => ScheduledAutomationRunOutcome,
): Promise<T> {
  const startedAt = new Date();
  try {
    const result = await run();
    await recordScheduledAutomationRun(userId, automationKey, startedAt, summarize(result));
    return result;
  } catch (error: any) {
    const message = error?.message || "Scheduled automation failed";
    await recordScheduledAutomationRun(userId, automationKey, startedAt, {
      status: "failed",
      resultSummary: `${automationKey} failed`,
      errorMessage: message,
      metadata: { error: message },
    });
    throw error;
  }
}

let lastMorningNotification: string | null = null;
let lastEveningNotification: string | null = null;
let lastWeeklyNotification: string | null = null;
let lastInsightsNotification: string | null = null;
let lastRadioAnalysis: string | null = null;
let lastRadioTemplateGeneration: string | null = null;
let lastPortfolioReport: string | null = null;
let lastVideoEditCheck: string | null = null;
let lastNewsNotification: string | null = null;
let lastDropshippingDailyCycle: string | null = null;
let lastDropshippingMorningReport: string | null = null;
let lastDropshippingEveningReport: string | null = null;
const userRemindersSent: Map<string, string> = new Map();

export function getZonedClock(date: Date): SchedulerClock {
  return getClockInTimezone(date, getReminderSchedulerConfig().timezone);
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

async function getTodaysTasks(userId = getSystemUserId()): Promise<{ pending: string[]; completed: string[] }> {
  const tasks = await storage.getTasks(userId);
  const today = new Date();
  
  const todaysTasks = tasks.filter((task) => isSameDay(new Date(task.date), today));
  
  const pending = todaysTasks.filter((t) => !t.completed).map((t) => t.title);
  const completed = todaysTasks.filter((t) => t.completed).map((t) => t.title);
  
  return { pending, completed };
}

async function getIncompleteWeeklyTasks(userId = getSystemUserId()): Promise<string[]> {
  const weekStart = getWeekStart(new Date());
  const weeklyTasks = await storage.getWeeklyTasks(userId, weekStart);
  
  return weeklyTasks.filter((t) => !t.completed).map((t) => t.title);
}

async function sendMorningReminder(): Promise<void> {
  const results = await sendMorningReminderWithDeps({
    getScheduledNotificationUserIds,
    getTodaysTasks,
    generateCeoMorningBrief,
    sendPushNotification,
    sendTelegramNotificationToUser,
    recordScheduledAutomationRun,
    now: () => new Date(),
  });

  for (const result of results) {
    console.log(`[Reminder] CEO morning brief sent for ${result.userId} - ${result.pendingCount} pending tasks`);
  }
}

async function sendMorningReminderForUser(userId: string): Promise<void> {
  const { pending } = await getTodaysTasks(userId);
  const title = "🌅 Brief CEO";
  const body = await generateCeoMorningBrief(userId);

  await Promise.all([
    sendPushNotification(userId, { title, body: pending.length > 0 ? `${pending.length} pendiente(s) para hoy.` : "Brief ejecutivo listo.", url: "/", tag: "morning-reminder" }),
    sendTelegramNotificationToUser(userId, title, body, true),
  ]);

  console.log(`[Reminder] CEO morning brief test sent for ${userId} - ${pending.length} pending tasks`);
}

async function sendEveningReminder(): Promise<void> {
  const results = await sendEveningReminderWithDeps({
    getScheduledNotificationUserIds,
    getTodaysTasks,
    sendPushNotification,
    sendTelegramNotificationToUser,
    recordScheduledAutomationRun,
    now: () => new Date(),
  });

  for (const result of results) {
    if (result.sent) {
      console.log(`[Reminder] Evening notification sent for ${result.userId} - ${result.pendingCount} incomplete tasks`);
    } else {
      console.log(`[Reminder] All tasks completed for ${result.userId} today - skipping evening notification`);
    }
  }
}

async function sendEveningReminderForUser(userId: string): Promise<void> {
  const title = "🌙 Tareas sin Completar";
  const { pending } = await getTodaysTasks(userId);

  if (pending.length === 0) {
    console.log(`[Reminder] All tasks completed for ${userId} today - skipping evening notification`);
    return;
  }

  const taskList = pending.slice(0, 5).join("\n• ");
  const moreText = pending.length > 5 ? `\n+${pending.length - 5} más` : "";
  const body = `Quedan ${pending.length} tarea${pending.length > 1 ? "s" : ""} por hacer:\n• ${taskList}${moreText}`;

  await Promise.all([
    sendPushNotification(userId, { title, body, url: "/", tag: "evening-reminder" }),
    sendTelegramNotificationToUser(userId, title, body, true),
  ]);

  console.log(`[Reminder] Evening notification test sent for ${userId} - ${pending.length} incomplete tasks`);
}

async function sendWeeklyReminder(): Promise<void> {
  const results = await sendWeeklyReminderWithDeps({
    getScheduledNotificationUserIds,
    getIncompleteWeeklyTasks,
    sendPushNotification,
    sendTelegramNotificationToUser,
    recordScheduledAutomationRun,
    now: () => new Date(),
  });

  for (const result of results) {
    if (result.sent) {
      console.log(`[Reminder] Weekly notification sent for ${result.userId} - ${result.incompleteCount} incomplete weekly tasks`);
    } else {
      console.log(`[Reminder] All weekly tasks completed for ${result.userId} - skipping weekly notification`);
    }
  }
}

async function sendWeeklyReminderForUser(userId: string): Promise<void> {
  const title = "📅 Tareas Semanales Pendientes";
  const incompleteTasks = await getIncompleteWeeklyTasks(userId);

  if (incompleteTasks.length === 0) {
    console.log(`[Reminder] All weekly tasks completed for ${userId} - skipping weekly notification`);
    return;
  }

  const taskList = incompleteTasks.slice(0, 5).join("\n• ");
  const moreText = incompleteTasks.length > 5 ? `\n+${incompleteTasks.length - 5} más` : "";
  const body = `Tienes ${incompleteTasks.length} tarea${incompleteTasks.length > 1 ? "s" : ""} semanal${incompleteTasks.length > 1 ? "es" : ""} pendiente${incompleteTasks.length > 1 ? "s" : ""}:\n• ${taskList}${moreText}`;

  await Promise.all([
    sendPushNotification(userId, { title, body, url: "/", tag: "weekly-reminder" }),
    sendTelegramNotificationToUser(userId, title, body, true),
  ]);

  console.log(`[Reminder] Weekly notification test sent for ${userId} - ${incompleteTasks.length} incomplete weekly tasks`);
}

async function sendDailyNewsDigest(): Promise<{ sent: boolean; newsCount: number }> {
  try {
    const userIds = await getScheduledNotificationUserIds();
    const results = await Promise.all(userIds.map((userId) => runTrackedScheduledAutomation(
      userId,
      "portfolio-news-digest",
      () => sendDailyNewsDigestForUser(userId),
      (result) => ({
        status: result.sent ? "success" : "skipped",
        resultSummary: result.sent
          ? `Portfolio news digest sent with ${result.newsCount} news item(s).`
          : "Portfolio news digest skipped because no news was sent.",
        metadata: result,
      }),
    )));

    return {
      sent: results.some((result) => result.sent),
      newsCount: results.reduce((total, result) => total + result.newsCount, 0),
    };
  } catch (error) {
    console.error("[Reminder] Error sending news digest:", error);
    return { sent: false, newsCount: 0 };
  }
}

export async function sendDailyNewsDigestForUserWithDeps(
  userId: string,
  deps: NewsDigestSchedulerDeps,
): Promise<NewsDigestRunResult> {
  const investments = await deps.getInvestments(userId);
  const symbols = investments.map(inv => inv.symbol);
  if (symbols.length === 0) {
    console.log(`[Reminder] No portfolio symbols for ${userId} news digest`);
    return { sent: false, newsCount: 0 };
  }

  const news = await deps.getPortfolioNews(symbols);

  if (news.length === 0) {
    console.log(`[Reminder] No news available for ${userId} portfolio`);
    return { sent: false, newsCount: 0 };
  }

  const topNews = news.slice(0, 5);
  const newsItems = topNews.map((n, i) =>
    `${i + 1}. ${n.related}: ${n.headline}\n   ${n.url}`
  ).join("\n\n");

  const title = "📰 Noticias de tu Portafolio";
  const body = `${newsItems}\n\nTotal: ${news.length} noticias disponibles`;

  const sent = await deps.sendTelegramNotificationToUser(userId, title, body, true);
  console.log(`[Reminder] Daily news digest ${sent ? "sent" : "not sent"} for ${userId} - ${news.length} news items`);
  return { sent, newsCount: news.length };
}

async function sendDailyNewsDigestForUser(userId: string): Promise<NewsDigestRunResult> {
  return sendDailyNewsDigestForUserWithDeps(userId, {
    getInvestments: storage.getInvestments.bind(storage),
    getPortfolioNews,
    sendTelegramNotificationToUser,
  });
}

export async function runRadioTemplateGenerationForUserWithDeps(
  userId: string,
  deps: RadioTemplateGenerationDeps,
): Promise<string> {
  const automations = await deps.ensureDefaultAutomations(userId);
  const automation = automations.find((item) => (item.metadata as any)?.key === "radio-template-generation");
  const startedAt = deps.now();

  try {
    const result = await deps.generateRadioTemplatesForDate(userId);
    const status = result.failed > 0 ? "failed" : result.generated > 0 || result.skipped > 0 ? "success" : "skipped";
    const resultSummary = `Radio templates ${status}: ${result.generated} generated, ${result.skipped} skipped, ${result.failed} failed for ${result.dateKey}`;

    if (automation) {
      await deps.createAutomationRun({
        automationId: automation.id,
        ownerUserId: userId,
        startedAt,
        finishedAt: deps.now(),
        status,
        triggeredBy: "scheduler",
        resultSummary,
        errorMessage: status === "failed" ? result.files.find((file) => file.status === "failed")?.errorMessage || null : null,
        costEstimate: automation.costEstimate,
        pendingActionId: null,
        auditLogId: null,
        metadata: result,
      });
    }

    return resultSummary;
  } catch (error: any) {
    const message = error?.message || "Radio template generation failed";
    if (automation) {
      await deps.createAutomationRun({
        automationId: automation.id,
        ownerUserId: userId,
        startedAt,
        finishedAt: deps.now(),
        status: "failed",
        triggeredBy: "scheduler",
        resultSummary: "Radio template generation failed",
        errorMessage: message,
        costEstimate: automation.costEstimate,
        pendingActionId: null,
        auditLogId: null,
        metadata: { error: message },
      });
    }
    return `Radio templates failed: ${message}`;
  }
}

async function sendDropshippingCeoReports(cadence: "morning" | "evening"): Promise<void> {
  const userIds = await getScheduledNotificationUserIds();
  const automationKey = cadence === "morning" ? "dropshipping-ceo-morning-report" : "dropshipping-ceo-evening-report";
  const results = await Promise.all(userIds.map((userId) => runTrackedScheduledAutomation(
    userId,
    automationKey,
    () => sendDropshippingDailyReport(userId, cadence),
    (result) => ({
      status: result.sent ? "success" : "skipped",
      resultSummary: result.reason,
      metadata: {
        sent: result.sent,
        cadence,
        metrics: result.snapshot.metrics,
        profitGuard: result.snapshot.profitGuard.status,
      },
    }),
  )));
  const sentCount = results.filter((result) => result.sent).length;
  console.log(`[Dropshipping] ${cadence} CEO reports processed for ${userIds.length} user(s) - ${sentCount} sent`);
}

async function runDropshippingCeoDailyCycle(): Promise<void> {
  const userIds = await getScheduledNotificationUserIds();
  const userId = userIds[0] || getSystemUserId();
  const result = await runTrackedScheduledAutomation(
    userId,
    "dropshipping-ceo-daily-operating-cycle",
    async () => runDropshippingDailyOperatingCycle(),
    (cycleResult) => ({
      status: "success",
      resultSummary: cycleResult.summary,
      metadata: {
        mode: cycleResult.mode,
        forcePaidTest: cycleResult.forcePaidTest,
        generatedCampaignIds: cycleResult.cycle.generatedCampaignIds,
        generatedPostIds: cycleResult.cycle.generatedPostIds,
        safety: cycleResult.safety,
        metrics: cycleResult.snapshot.metrics,
        profitGuard: cycleResult.snapshot.profitGuard.status,
      },
    }),
  );
  console.log(`[Dropshipping] Daily operating cycle processed for ${userId}: ${result.summary}`);
}

async function runRadioTemplateGenerationForUser(userId: string): Promise<string> {
  return runRadioTemplateGenerationForUserWithDeps(userId, {
    ensureDefaultAutomations: getExistingAutomations,
    generateRadioTemplatesForDate,
    createAutomationRun: storage.createAutomationRun.bind(storage),
    now: () => new Date(),
  });
}

async function checkScheduledReminders(): Promise<void> {
  const now = new Date();
  const config = getReminderSchedulerConfig();
  const clock = getZonedClock(now);
  const { hour, minute, dayOfWeek } = clock;
  const dateKey = getDateKeyFromClock(clock);
  const weekKey = dateKey;
  
  try {
    if (shouldRunDailyScheduledJob(clock, config.ceoBriefHour, config.ceoBriefMinute, lastMorningNotification)) {
      lastMorningNotification = dateKey;
      await sendMorningReminder();
    }

    if (shouldRunDailyScheduledJob(clock, config.dropshippingCeoCycleHour, config.dropshippingCeoCycleMinute, lastDropshippingDailyCycle)) {
      lastDropshippingDailyCycle = dateKey;
      await runDropshippingCeoDailyCycle();
    }

    if (shouldRunDailyScheduledJob(clock, config.dropshippingCeoMorningHour, config.dropshippingCeoMorningMinute, lastDropshippingMorningReport)) {
      lastDropshippingMorningReport = dateKey;
      await sendDropshippingCeoReports("morning");
    }
    
    if (shouldRunDailyScheduledJob(clock, config.insightsHour, 0, lastInsightsNotification)) {
      lastInsightsNotification = dateKey;
      const results = await sendProactiveInsightsWithDeps({
        getScheduledNotificationUserIds,
        sendProactiveInsights,
        recordScheduledAutomationRun,
        now: () => new Date(),
      });
      const sentCount = results.filter((result) => result.sent).length;
      const insightCount = results.reduce((total, result) => total + result.insights, 0);
      console.log(`[Reminder] Proactive insights processed for ${results.length} user(s) - ${sentCount} sent, ${insightCount} insights`);
    }

    if (shouldRunDailyScheduledJob(clock, 8, 15, lastRadioTemplateGeneration)) {
      lastRadioTemplateGeneration = dateKey;
      const userIds = await getScheduledNotificationUserIds();
      const results = await Promise.all(userIds.map((userId) => runRadioTemplateGenerationForUser(userId)));
      console.log(`[Agent] Radio template generation processed for ${userIds.length} user(s): ${results.join("; ")}`);
    }
    
    // Daily news digest at 9:00 AM
    if (shouldRunDailyScheduledJob(clock, config.newsDigestHour, 0, lastNewsNotification)) {
      lastNewsNotification = dateKey;
      const result = await sendDailyNewsDigest();
      if (result.sent) {
        console.log(`[Reminder] Daily news digest sent - ${result.newsCount} news items`);
      }
    }
    
    if (shouldRunDailyScheduledJob(clock, config.eveningReviewHour, 0, lastEveningNotification)) {
      lastEveningNotification = dateKey;
      await sendEveningReminder();
    }

    if (shouldRunDailyScheduledJob(clock, config.dropshippingCeoEveningHour, config.dropshippingCeoEveningMinute, lastDropshippingEveningReport)) {
      lastDropshippingEveningReport = dateKey;
      await sendDropshippingCeoReports("evening");
    }
    
    if (dayOfWeek === 0 && hour === 18 && minute === 0 && lastWeeklyNotification !== weekKey) {
      lastWeeklyNotification = weekKey;
      await sendWeeklyReminder();
    }
    
    // Agent Actions - Radio analysis Monday 8:00 AM
    if (dayOfWeek === 1 && hour === 8 && minute === 0 && lastRadioAnalysis !== weekKey) {
      lastRadioAnalysis = weekKey;
      const results = await runScheduledAgentActionWithDeps(
        "radio-slot-check",
        "radio_notify_slots",
        {
          getScheduledNotificationUserIds,
          executeAction,
          recordScheduledAutomationRun,
          now: () => new Date(),
        },
      );
      console.log(`[Agent] Radio analysis processed for ${results.length} user(s): ${results.map((result) => result.message).join("; ")}`);
    }
    
    // Agent Actions - Portfolio weekly report Sunday 10:00 AM
    if (dayOfWeek === 0 && hour === 10 && minute === 0 && lastPortfolioReport !== weekKey) {
      lastPortfolioReport = weekKey;
      const results = await runScheduledAgentActionWithDeps(
        "portfolio-weekly-report",
        "portfolio_weekly_report",
        {
          getScheduledNotificationUserIds,
          executeAction,
          recordScheduledAutomationRun,
          now: () => new Date(),
        },
      );
      console.log(`[Agent] Portfolio report processed for ${results.length} user(s): ${results.map((result) => result.message).join("; ")}`);
    }
    
    // Agent Actions - Create video edit tasks Friday 10:00 AM
    if (dayOfWeek === 5 && hour === 10 && minute === 0 && lastVideoEditCheck !== dateKey) {
      lastVideoEditCheck = dateKey;
      const results = await runScheduledAgentActionWithDeps(
        "video-edit-task-check",
        "create_video_edit_task",
        {
          getScheduledNotificationUserIds,
          executeAction,
          recordScheduledAutomationRun,
          now: () => new Date(),
        },
      );
      console.log(`[Agent] Video edit task check processed for ${results.length} user(s): ${results.map((result) => result.message).join("; ")}`);
    }
    
    // User scheduled reminders
    await processUserScheduledReminders(now, dateKey);
  } catch (error) {
    console.error("[Reminder] Error checking scheduled reminders:", error);
  }
}

const dayNameToNumber: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

export async function processUserScheduledRemindersWithDeps(
  now: Date,
  dateKey: string,
  deps: UserScheduledReminderSchedulerDeps,
): Promise<UserScheduledReminderRunResult[]> {
  const reminders = await deps.getActiveScheduledReminders();
  const clock = deps.getZonedClock(now);
  const { hour, minute, dayOfWeek } = clock;
  const results: UserScheduledReminderRunResult[] = [];

  for (const reminder of reminders) {
    if (reminder.hour !== hour || reminder.minute !== minute) continue;

    const reminderKey = `${reminder.id}-${dateKey}`;
    if (deps.sentReminderKeys.has(reminderKey)) continue;

    if (reminder.daysOfWeek && reminder.daysOfWeek.length > 0) {
      const shouldRunToday = reminder.daysOfWeek.some(
        (day: string) => dayNameToNumber[day.toLowerCase()] === dayOfWeek,
      );
      if (!shouldRunToday) continue;
    }

    const sent = await deps.sendTelegramNotificationToUser(reminder.userId, "⏰ Recordatorio", reminder.message, true);
    if (!sent) continue;

    deps.sentReminderKeys.set(reminderKey, dateKey);
    results.push({ reminderId: reminder.id, userId: reminder.userId, message: reminder.message, sent });
  }

  return results;
}

async function processUserScheduledReminders(now: Date, dateKey: string): Promise<void> {
  try {
    const results = await processUserScheduledRemindersWithDeps(now, dateKey, {
      getActiveScheduledReminders: storage.getActiveScheduledReminders.bind(storage),
      getZonedClock,
      sendTelegramNotificationToUser,
      sentReminderKeys: userRemindersSent,
    });

    for (const result of results) {
      console.log(`[Reminder] User reminder sent: ${result.message}`);
    }
  } catch (error) {
    console.error("[Reminder] Error processing user scheduled reminders:", error);
  }
}

export function startReminderScheduler(): void {
  const config = getReminderSchedulerConfig();
  console.log("[Reminder] Starting reminder scheduler...");
  console.log(`[Reminder] Schedule timezone: ${config.timezone}`);
  console.log(`[Reminder] Schedule: CEO Brief ${config.ceoBriefHour}:${String(config.ceoBriefMinute).padStart(2, "0")}, Insights ${config.insightsHour}:00, News ${config.newsDigestHour}:00, Evening ${config.eveningReviewHour}:00, Weekly Sunday 18:00`);
  console.log(`[Dropshipping] Schedule: Cycle ${config.dropshippingCeoCycleHour}:${String(config.dropshippingCeoCycleMinute).padStart(2, "0")}, AM ${config.dropshippingCeoMorningHour}:${String(config.dropshippingCeoMorningMinute).padStart(2, "0")}, PM ${config.dropshippingCeoEveningHour}:${String(config.dropshippingCeoEveningMinute).padStart(2, "0")}`);
  console.log("[Agent] Schedule: Radio Monday 8:00 AM, Radio Templates daily 8:15 AM, Portfolio Sunday 10:00 AM, Video Tasks Friday 10:00 AM");
  
  setInterval(checkScheduledReminders, 60 * 1000);
  
  checkScheduledReminders();
}

export async function testMorningReminder(userId?: string): Promise<{ success: boolean; message: string }> {
  try {
    if (userId) await sendMorningReminderForUser(userId);
    else await sendMorningReminder();
    return { success: true, message: "CEO morning brief sent" };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function testCeoMorningBrief(userId = getSystemUserId()): Promise<{ success: boolean; message: string }> {
  try {
    await sendMorningReminderForUser(userId);
    return { success: true, message: "CEO morning brief sent" };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function testEveningReminder(userId?: string): Promise<{ success: boolean; message: string }> {
  try {
    if (userId) await sendEveningReminderForUser(userId);
    else await sendEveningReminder();
    return { success: true, message: "Evening reminder sent" };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function testWeeklyReminder(userId?: string): Promise<{ success: boolean; message: string }> {
  try {
    if (userId) await sendWeeklyReminderForUser(userId);
    else await sendWeeklyReminder();
    return { success: true, message: "Weekly reminder sent" };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function testProactiveInsights(userId?: string): Promise<{ success: boolean; message: string; insights: number }> {
  try {
    const userIds = userId ? [userId] : await getScheduledNotificationUserIds();
    const results = await Promise.all(userIds.map((userId) => sendProactiveInsights(userId)));
    const sent = results.some((result) => result.sent);
    const insights = results.reduce((total, result) => total + result.insights, 0);
    return {
      success: sent,
      message: sent ? "Proactive insights sent" : "No insights to send or Telegram not configured",
      insights
    };
  } catch (error: any) {
    return { success: false, message: error.message, insights: 0 };
  }
}

export async function testNewsDigest(userId?: string): Promise<{ success: boolean; message: string; newsCount: number }> {
  try {
    const result = userId ? await sendDailyNewsDigestForUser(userId) : await sendDailyNewsDigest();
    return { 
      success: result.sent, 
      message: result.sent ? "News digest sent" : "No news available or FINNHUB_API_KEY not configured",
      newsCount: result.newsCount 
    };
  } catch (error: any) {
    return { success: false, message: error.message, newsCount: 0 };
  }
}
