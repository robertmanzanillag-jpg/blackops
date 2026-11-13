import { type User, type InsertUser, type Task, type InsertTask, type WeeklySummary, type InsertWeeklySummary, type MonthlyGoal, type InsertMonthlyGoal, type YearlyGoal, type InsertYearlyGoal, type WeeklyTask, type InsertWeeklyTask, type PushSubscription, type InsertPushSubscription, type TelegramConfig, type InsertTelegramConfig, type Investment, type InsertInvestment, type Transaction, type InsertTransaction, type WatchlistItem, type InsertWatchlistItem, type PriceAlert, type InsertPriceAlert, type UserProfileData, type InsertUserProfileData, type MonitoredProject, type InsertMonitoredProject, type HealthCheckLog, type InsertHealthCheckLog, type Incident, type InsertIncident, type AppProject, type InsertAppProject, type AppHealthCheck, type InsertAppHealthCheck, type AppIncident, type InsertAppIncident, type AppErrorEvent, type InsertAppErrorEvent, type AppDailyReport, type InsertAppDailyReport, type PortfolioHistory, type InsertPortfolioHistory, type DjContact, type InsertDjContact, type RadioTemplateAsset, type InsertRadioTemplateAsset, type CanvaOAuthToken, type InsertCanvaOAuthToken, type GoogleDriveOAuthToken, type InsertGoogleDriveOAuthToken, type AgentAction, type InsertAgentAction, type AuditLog, type InsertAuditLog, type PendingAction, type InsertPendingAction, type PendingActionEvent, type InsertPendingActionEvent, type AssistantPermission, type InsertAssistantPermission, type AutomationDefinition, type InsertAutomationDefinition, type AutomationRun, type InsertAutomationRun, type DjMessageTemplate, type InsertDjMessageTemplate, type ScheduledReminder, type InsertScheduledReminder } from "@shared/schema";
import { revenueStripeEvents as revenueStripeEventsTable, type RevenueStripeEvent, type InsertRevenueStripeEvent } from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { tasks as tasksTable, users as usersTable, weeklySummaries as weeklySummariesTable, monthlyGoals as monthlyGoalsTable, yearlyGoals as yearlyGoalsTable, weeklyTasks as weeklyTasksTable, pushSubscriptions as pushSubscriptionsTable, appRateLimitBuckets as appRateLimitBucketsTable, telegramConfig as telegramConfigTable, telegramProcessedUpdates as telegramProcessedUpdatesTable, investments as investmentsTable, transactions as transactionsTable, watchlist as watchlistTable, priceAlerts as priceAlertsTable, userProfileData as userProfileDataTable, monitoredProjects as monitoredProjectsTable, healthCheckLogs as healthCheckLogsTable, incidents as incidentsTable, appProjects as appProjectsTable, appHealthChecks as appHealthChecksTable, appIncidents as appIncidentsTable, appErrorEvents as appErrorEventsTable, appDailyReports as appDailyReportsTable, portfolioHistory as portfolioHistoryTable, djContacts as djContactsTable, radioTemplateAssets as radioTemplateAssetsTable, canvaOAuthTokens as canvaOAuthTokensTable, googleDriveOAuthTokens as googleDriveOAuthTokensTable, agentActions as agentActionsTable, auditLogs as auditLogsTable, pendingActions as pendingActionsTable, pendingActionEvents as pendingActionEventsTable, assistantPermissions as assistantPermissionsTable, automationDefinitions as automationDefinitionsTable, automationRuns as automationRunsTable, djMessageTemplates as djMessageTemplatesTable, scheduledReminders as scheduledRemindersTable, portfolioConfig as portfolioConfigTable } from "@shared/schema";
import { eq, and, desc, gte, lt, isNull, sql } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Task operations
  getTasks(userId: string): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  createTask(userId: string, task: InsertTask): Promise<Task>;
  updateTask(id: string, task: Partial<InsertTask>): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  deleteTasksByTitle(userId: string, title: string): Promise<number>;
  deduplicateMainTasks(userId: string): Promise<number>;

  // Weekly Summary operations
  getWeeklySummaries(userId: string): Promise<WeeklySummary[]>;
  getWeeklySummary(userId: string, weekStart: Date): Promise<WeeklySummary | undefined>;
  getWeeklySummaryById(id: string): Promise<WeeklySummary | undefined>;
  createWeeklySummary(userId: string, summary: InsertWeeklySummary): Promise<WeeklySummary>;
  updateWeeklySummary(id: string, summary: Partial<InsertWeeklySummary>): Promise<WeeklySummary>;

  // Monthly Goals operations
  getMonthlyGoals(userId: string, month: Date): Promise<MonthlyGoal[]>;
  getAllMonthlyGoals(userId: string): Promise<MonthlyGoal[]>;
  getMonthlyGoal(id: string): Promise<MonthlyGoal | undefined>;
  createMonthlyGoal(userId: string, goal: InsertMonthlyGoal): Promise<MonthlyGoal>;
  updateMonthlyGoal(id: string, updates: Partial<InsertMonthlyGoal>): Promise<MonthlyGoal>;
  deleteMonthlyGoal(id: string): Promise<void>;

  // Yearly Goals operations
  getYearlyGoals(userId: string, year: string): Promise<YearlyGoal[]>;
  getYearlyGoal(id: string): Promise<YearlyGoal | undefined>;
  createYearlyGoal(userId: string, goal: InsertYearlyGoal): Promise<YearlyGoal>;
  updateYearlyGoal(id: string, updates: Partial<InsertYearlyGoal>): Promise<YearlyGoal>;
  deleteYearlyGoal(id: string): Promise<void>;

  // Weekly Tasks operations
  getWeeklyTasks(userId: string, weekStart: Date): Promise<WeeklyTask[]>;
  getWeeklyTaskById(id: string): Promise<WeeklyTask | undefined>;
  getRecurringTasks(userId: string): Promise<WeeklyTask[]>;
  getPreviousWeekIncompleteTasks(userId: string, currentWeekStart: Date): Promise<WeeklyTask[]>;
  createWeeklyTask(userId: string, task: InsertWeeklyTask): Promise<WeeklyTask>;
  updateWeeklyTask(id: string, updates: Partial<InsertWeeklyTask>): Promise<WeeklyTask>;
  deleteWeeklyTask(id: string): Promise<void>;
  deduplicateRecurringTasks(userId: string): Promise<number>;

  // Push Subscriptions operations
  getPushSubscriptions(userId: string): Promise<PushSubscription[]>;
  getAllPushSubscriptions(): Promise<PushSubscription[]>;
  createPushSubscription(userId: string, sub: InsertPushSubscription): Promise<PushSubscription>;
  deletePushSubscription(endpoint: string): Promise<void>;
  checkPersistentRateLimit(key: string, limit: number, windowMs: number, now?: number): Promise<{ allowed: boolean; remaining: number; resetAt: number }>;

  // Telegram Config operations
  getTelegramConfig(userId: string): Promise<TelegramConfig | undefined>;
  getTelegramConfigByChatId(chatId: string): Promise<TelegramConfig | undefined>;
  getEnabledTelegramConfigs(): Promise<TelegramConfig[]>;
  saveTelegramConfig(userId: string, chatId: string): Promise<TelegramConfig>;
  updateTelegramConfig(userId: string, enabled: boolean): Promise<TelegramConfig | undefined>;
  deleteTelegramConfig(userId: string): Promise<void>;
  recordTelegramProcessedUpdate(updateId: number): Promise<boolean>;
  getRevenueStripeEvent(eventId: string): Promise<RevenueStripeEvent | undefined>;
  createRevenueStripeEvent(event: InsertRevenueStripeEvent): Promise<boolean>;
  updateRevenueStripeEvent(eventId: string, updates: Partial<Pick<RevenueStripeEvent, "status" | "errorMessage" | "processedAt" | "notifiedAt">>): Promise<void>;

  // Investment operations
  getInvestments(userId: string): Promise<Investment[]>;
  getInvestment(id: string): Promise<Investment | undefined>;
  createInvestment(userId: string, investment: InsertInvestment): Promise<Investment>;
  updateInvestment(id: string, updates: Partial<InsertInvestment>): Promise<Investment>;
  deleteInvestment(id: string): Promise<void>;
  
  // Portfolio config operations
  getPortfolioConfig(userId: string): Promise<{ marginUsed: string; marginTotal: string } | undefined>;
  updatePortfolioConfig(userId: string, marginUsed: string, marginTotal: string): Promise<void>;

  // Transaction operations
  getTransactions(userId: string): Promise<Transaction[]>;
  createTransaction(userId: string, transaction: InsertTransaction): Promise<Transaction>;

  // Watchlist operations
  getWatchlist(userId: string): Promise<WatchlistItem[]>;
  getWatchlistItem(id: string): Promise<WatchlistItem | undefined>;
  addToWatchlist(userId: string, item: InsertWatchlistItem): Promise<WatchlistItem>;
  removeFromWatchlist(id: string): Promise<void>;

  // Price Alert operations
  getPriceAlerts(userId: string): Promise<PriceAlert[]>;
  getPriceAlert(id: string): Promise<PriceAlert | undefined>;
  createPriceAlert(userId: string, alert: InsertPriceAlert): Promise<PriceAlert>;
  updatePriceAlert(id: string, updates: Partial<InsertPriceAlert>): Promise<PriceAlert>;
  deletePriceAlert(id: string): Promise<void>;

  // User Profile Data operations
  getUserProfileData(userId: string): Promise<UserProfileData[]>;
  getUserProfileDataByCategory(userId: string, category: string): Promise<UserProfileData[]>;
  getUserProfileDataByKey(userId: string, key: string): Promise<UserProfileData | undefined>;
  saveUserProfileData(userId: string, data: InsertUserProfileData): Promise<UserProfileData>;
  updateUserProfileData(id: string, updates: Partial<InsertUserProfileData>): Promise<UserProfileData>;
  deleteUserProfileData(id: string): Promise<void>;

  // Monitored Projects operations
  getMonitoredProjects(userId: string): Promise<MonitoredProject[]>;
  getAllMonitoredProjects(): Promise<MonitoredProject[]>;
  getMonitoredProject(id: string): Promise<MonitoredProject | undefined>;
  createMonitoredProject(userId: string, project: InsertMonitoredProject): Promise<MonitoredProject>;
  updateMonitoredProject(id: string, updates: Partial<MonitoredProject>): Promise<MonitoredProject>;
  deleteMonitoredProject(id: string): Promise<void>;

  // Health Check Log operations
  getHealthCheckLogs(projectId: string, limit?: number): Promise<HealthCheckLog[]>;
  createHealthCheckLog(log: InsertHealthCheckLog): Promise<HealthCheckLog>;

  // Incident operations
  getIncidents(projectId: string): Promise<Incident[]>;
  getActiveIncident(projectId: string): Promise<Incident | undefined>;
  createIncident(incident: InsertIncident): Promise<Incident>;
  resolveIncident(id: string): Promise<Incident>;

  // Developer Health Center operations
  getAppProjects(userId: string): Promise<AppProject[]>;
  getAppProject(id: string): Promise<AppProject | undefined>;
  createAppProject(userId: string, project: InsertAppProject): Promise<AppProject>;
  updateAppProject(id: string, updates: Partial<AppProject>): Promise<AppProject>;
  getAppHealthChecks(appProjectId: string, limit?: number): Promise<AppHealthCheck[]>;
  createAppHealthCheck(check: InsertAppHealthCheck): Promise<AppHealthCheck>;
  getAppIncidents(userId: string, status?: string): Promise<AppIncident[]>;
  getAppIncidentsForProject(appProjectId: string): Promise<AppIncident[]>;
  getAppIncident(id: string): Promise<AppIncident | undefined>;
  createAppIncident(incident: InsertAppIncident): Promise<AppIncident>;
  updateAppIncident(id: string, updates: Partial<AppIncident>): Promise<AppIncident>;
  getAppErrorEvents(appProjectId: string, limit?: number): Promise<AppErrorEvent[]>;
  getAppErrorEventsForIncident(incidentId: string): Promise<AppErrorEvent[]>;
  createAppErrorEvent(event: InsertAppErrorEvent): Promise<AppErrorEvent>;
  getAppDailyReports(appProjectId: string, limit?: number): Promise<AppDailyReport[]>;
  createAppDailyReport(report: InsertAppDailyReport): Promise<AppDailyReport>;

  // Portfolio History operations
  getPortfolioHistory(userId: string, days?: number): Promise<PortfolioHistory[]>;
  createPortfolioSnapshot(userId: string, snapshot: InsertPortfolioHistory): Promise<PortfolioHistory>;
  getLatestPortfolioSnapshot(userId: string): Promise<PortfolioHistory | undefined>;

  // DJ Contact operations
  getDjContacts(userId: string): Promise<DjContact[]>;
  getDjContact(id: string): Promise<DjContact | undefined>;
  getAvailableDjContacts(userId: string): Promise<DjContact[]>;
  createDjContact(userId: string, contact: InsertDjContact): Promise<DjContact>;
  updateDjContact(id: string, updates: Partial<InsertDjContact>): Promise<DjContact>;
  deleteDjContact(id: string): Promise<void>;

  // Radio Template Asset operations
  getRadioTemplateAssets(userId: string, eventId?: string): Promise<RadioTemplateAsset[]>;
  getRadioTemplateAsset(userId: string, eventId: string, slotHour: number): Promise<RadioTemplateAsset | undefined>;
  upsertRadioTemplateAsset(userId: string, asset: InsertRadioTemplateAsset): Promise<RadioTemplateAsset>;
  updateRadioTemplateAsset(id: string, updates: Partial<RadioTemplateAsset>): Promise<RadioTemplateAsset>;
  getCanvaOAuthToken(userId: string): Promise<CanvaOAuthToken | undefined>;
  saveCanvaOAuthToken(userId: string, token: InsertCanvaOAuthToken): Promise<CanvaOAuthToken>;
  getGoogleDriveOAuthToken(userId: string): Promise<GoogleDriveOAuthToken | undefined>;
  saveGoogleDriveOAuthToken(userId: string, token: InsertGoogleDriveOAuthToken): Promise<GoogleDriveOAuthToken>;

  // Agent Action operations
  getAgentActions(userId: string): Promise<AgentAction[]>;
  getPendingAgentActions(userId: string): Promise<AgentAction[]>;
  createAgentAction(userId: string, action: InsertAgentAction): Promise<AgentAction>;
  updateAgentAction(id: string, updates: Partial<AgentAction>): Promise<AgentAction>;

  // Trust & Control operations
  getAuditLogs(userId: string, limit?: number): Promise<AuditLog[]>;
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getPendingActions(userId: string): Promise<PendingAction[]>;
  getPendingAction(id: string): Promise<PendingAction | undefined>;
  createPendingAction(userId: string, action: InsertPendingAction): Promise<PendingAction>;
  updatePendingAction(id: string, updates: Partial<PendingAction>): Promise<PendingAction>;
  getPendingActionEvents(pendingActionId: string): Promise<PendingActionEvent[]>;
  getApprovalHistory(userId: string, limit?: number): Promise<PendingActionEvent[]>;
  createPendingActionEvent(event: InsertPendingActionEvent): Promise<PendingActionEvent>;
  getAssistantPermissions(userId: string): Promise<AssistantPermission[]>;
  upsertAssistantPermission(userId: string, permission: InsertAssistantPermission): Promise<AssistantPermission>;

  // Automation Manager operations
  getAutomationDefinitions(userId: string): Promise<AutomationDefinition[]>;
  getAutomationDefinition(id: string): Promise<AutomationDefinition | undefined>;
  createAutomationDefinition(userId: string, automation: InsertAutomationDefinition): Promise<AutomationDefinition>;
  updateAutomationDefinition(id: string, updates: Partial<AutomationDefinition>): Promise<AutomationDefinition>;
  getAutomationRuns(userId: string, automationId?: string, limit?: number): Promise<AutomationRun[]>;
  createAutomationRun(run: InsertAutomationRun): Promise<AutomationRun>;

  // DJ Message Template operations
  getDjMessageTemplates(userId: string): Promise<DjMessageTemplate[]>;
  createDjMessageTemplate(userId: string, template: InsertDjMessageTemplate): Promise<DjMessageTemplate>;
  getDefaultDjMessageTemplate(userId: string): Promise<DjMessageTemplate | undefined>;

  // Scheduled Reminder operations
  getScheduledReminders(userId: string): Promise<ScheduledReminder[]>;
  getActiveScheduledReminders(): Promise<ScheduledReminder[]>;
  createScheduledReminder(userId: string, reminder: InsertScheduledReminder): Promise<ScheduledReminder>;
  updateScheduledReminder(id: string, updates: Partial<ScheduledReminder>): Promise<ScheduledReminder>;
  deleteScheduledReminder(id: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const result = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, username))
      .limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = {
      ...insertUser,
      id,
    };
    await db.insert(usersTable).values(user);
    return user;
  }

  async getTasks(userId: string): Promise<Task[]> {
    const results = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.userId, userId));
    return results;
  }

  async getTask(id: string): Promise<Task | undefined> {
    const result = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id))
      .limit(1);
    return result[0];
  }

  async createTask(userId: string, task: InsertTask): Promise<Task> {
    const id = randomUUID();
    const newTask: Task = {
      id,
      userId,
      title: task.title,
      description: task.description || null,
      date: task.date,
      endDate: task.endDate || null,
      priority: task.priority || "normal",
      completed: task.completed || false,
      type: task.type || "task",
      isRecurring: task.isRecurring ?? false,
      externalId: task.externalId || null,
      externalSource: task.externalSource || null,
      originalDate: task.originalDate || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(tasksTable).values(newTask);
    return newTask;
  }

  async deduplicateMainTasks(userId: string): Promise<number> {
    // Only deduplicate user-created tasks (no externalSource) — never touch Google Calendar events
    // which are identified by externalId and can legitimately share a title across dates
    const allTasks = await db
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.userId, userId), isNull(tasksTable.externalSource)))
      .orderBy(desc(tasksTable.createdAt));

    const seen = new Set<string>();
    const idsToDelete: string[] = [];

    for (const task of allTasks) {
      if (seen.has(task.title)) {
        idsToDelete.push(task.id);
      } else {
        seen.add(task.title);
      }
    }

    for (const id of idsToDelete) {
      await db.delete(tasksTable).where(eq(tasksTable.id, id));
    }

    return idsToDelete.length;
  }

  async updateTask(id: string, updates: Partial<InsertTask>): Promise<Task> {
    const updateData: any = {
      ...updates,
      updatedAt: new Date(),
    };
    await db
      .update(tasksTable)
      .set(updateData)
      .where(eq(tasksTable.id, id));
    
    const result = await db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id))
      .limit(1);
    
    if (!result[0]) throw new Error("Task not found");
    return result[0];
  }

  async deleteTask(id: string): Promise<void> {
    await db.delete(tasksTable).where(eq(tasksTable.id, id));
  }

  async deleteTasksByTitle(userId: string, title: string): Promise<number> {
    const result = await db
      .delete(tasksTable)
      .where(and(eq(tasksTable.userId, userId), eq(tasksTable.title, title)));
    return result.rowCount || 0;
  }

  async getWeeklySummaries(userId: string): Promise<WeeklySummary[]> {
    const results = await db
      .select()
      .from(weeklySummariesTable)
      .where(eq(weeklySummariesTable.userId, userId))
      .orderBy(desc(weeklySummariesTable.weekStart));
    return results;
  }

  async getWeeklySummary(userId: string, weekStart: Date): Promise<WeeklySummary | undefined> {
    const result = await db
      .select()
      .from(weeklySummariesTable)
      .where(
        and(
          eq(weeklySummariesTable.userId, userId),
          eq(weeklySummariesTable.weekStart, weekStart)
        )
      )
      .limit(1);
    return result[0];
  }

  async getWeeklySummaryById(id: string): Promise<WeeklySummary | undefined> {
    const result = await db
      .select()
      .from(weeklySummariesTable)
      .where(eq(weeklySummariesTable.id, id))
      .limit(1);
    return result[0];
  }

  async createWeeklySummary(userId: string, summary: InsertWeeklySummary): Promise<WeeklySummary> {
    const id = randomUUID();
    const newSummary: WeeklySummary = {
      id,
      userId,
      weekStart: summary.weekStart,
      gratitude: summary.gratitude || null,
      completedAllTasks: summary.completedAllTasks ?? null,
      tasksIncompleteReason: summary.tasksIncompleteReason || null,
      talkedToFamily: summary.talkedToFamily ?? null,
      wentOutWithFriend: summary.wentOutWithFriend ?? null,
      learnedThisWeek: summary.learnedThisWeek || null,
      exercisedThreePlus: summary.exercisedThreePlus ?? null,
      helpedSomeone: summary.helpedSomeone ?? null,
      biggestAchievement: summary.biggestAchievement || null,
      hardestTask: summary.hardestTask || null,
      improvementsForNextWeek: summary.improvementsForNextWeek || null,
      pendingTasks: summary.pendingTasks || null,
      mostProductiveThing: summary.mostProductiveThing || null,
      nextWeekGoal: summary.nextWeekGoal || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(weeklySummariesTable).values(newSummary);
    return newSummary;
  }

  async updateWeeklySummary(id: string, updates: Partial<InsertWeeklySummary>): Promise<WeeklySummary> {
    const updateData: any = {
      ...updates,
      updatedAt: new Date(),
    };
    await db
      .update(weeklySummariesTable)
      .set(updateData)
      .where(eq(weeklySummariesTable.id, id));
    
    const result = await db
      .select()
      .from(weeklySummariesTable)
      .where(eq(weeklySummariesTable.id, id))
      .limit(1);
    
    if (!result[0]) throw new Error("Weekly summary not found");
    return result[0];
  }

  async getMonthlyGoals(userId: string, month: Date): Promise<MonthlyGoal[]> {
    const startOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
    const endOfMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    
    const results = await db
      .select()
      .from(monthlyGoalsTable)
      .where(
        and(
          eq(monthlyGoalsTable.userId, userId),
          gte(monthlyGoalsTable.month, startOfMonth),
          lt(monthlyGoalsTable.month, endOfMonth)
        )
      );
    return results;
  }

  async getAllMonthlyGoals(userId: string): Promise<MonthlyGoal[]> {
    const results = await db
      .select()
      .from(monthlyGoalsTable)
      .where(eq(monthlyGoalsTable.userId, userId))
      .orderBy(monthlyGoalsTable.month, monthlyGoalsTable.createdAt);
    return results;
  }

  async createMonthlyGoal(userId: string, goal: InsertMonthlyGoal): Promise<MonthlyGoal> {
    const id = randomUUID();
    const newGoal: MonthlyGoal = {
      id,
      userId,
      month: goal.month,
      title: goal.title,
      completed: goal.completed ?? false,
      createdAt: new Date(),
    };
    await db.insert(monthlyGoalsTable).values(newGoal);
    return newGoal;
  }

  async getMonthlyGoal(id: string): Promise<MonthlyGoal | undefined> {
    const result = await db
      .select()
      .from(monthlyGoalsTable)
      .where(eq(monthlyGoalsTable.id, id))
      .limit(1);
    return result[0];
  }

  async updateMonthlyGoal(id: string, updates: Partial<InsertMonthlyGoal>): Promise<MonthlyGoal> {
    await db
      .update(monthlyGoalsTable)
      .set(updates)
      .where(eq(monthlyGoalsTable.id, id));
    
    const result = await db
      .select()
      .from(monthlyGoalsTable)
      .where(eq(monthlyGoalsTable.id, id))
      .limit(1);
    
    if (!result[0]) throw new Error("Monthly goal not found");
    return result[0];
  }

  async deleteMonthlyGoal(id: string): Promise<void> {
    await db.delete(monthlyGoalsTable).where(eq(monthlyGoalsTable.id, id));
  }

  async getYearlyGoals(userId: string, year: string): Promise<YearlyGoal[]> {
    const results = await db
      .select()
      .from(yearlyGoalsTable)
      .where(
        and(
          eq(yearlyGoalsTable.userId, userId),
          eq(yearlyGoalsTable.year, year)
        )
      );
    return results;
  }

  async createYearlyGoal(userId: string, goal: InsertYearlyGoal): Promise<YearlyGoal> {
    const id = randomUUID();
    const newGoal: YearlyGoal = {
      id,
      userId,
      year: goal.year,
      title: goal.title,
      completed: goal.completed ?? false,
      createdAt: new Date(),
    };
    await db.insert(yearlyGoalsTable).values(newGoal);
    return newGoal;
  }

  async getYearlyGoal(id: string): Promise<YearlyGoal | undefined> {
    const result = await db
      .select()
      .from(yearlyGoalsTable)
      .where(eq(yearlyGoalsTable.id, id))
      .limit(1);
    return result[0];
  }

  async updateYearlyGoal(id: string, updates: Partial<InsertYearlyGoal>): Promise<YearlyGoal> {
    await db
      .update(yearlyGoalsTable)
      .set(updates)
      .where(eq(yearlyGoalsTable.id, id));
    
    const result = await db
      .select()
      .from(yearlyGoalsTable)
      .where(eq(yearlyGoalsTable.id, id))
      .limit(1);
    
    if (!result[0]) throw new Error("Yearly goal not found");
    return result[0];
  }

  async deleteYearlyGoal(id: string): Promise<void> {
    await db.delete(yearlyGoalsTable).where(eq(yearlyGoalsTable.id, id));
  }

  async getWeeklyTasks(userId: string, weekStart: Date): Promise<WeeklyTask[]> {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    
    const results = await db
      .select()
      .from(weeklyTasksTable)
      .where(
        and(
          eq(weeklyTasksTable.userId, userId),
          gte(weeklyTasksTable.weekStart, weekStart),
          lt(weeklyTasksTable.weekStart, weekEnd)
        )
      );
    return results;
  }

  async getWeeklyTaskById(id: string): Promise<WeeklyTask | undefined> {
    const result = await db
      .select()
      .from(weeklyTasksTable)
      .where(eq(weeklyTasksTable.id, id))
      .limit(1);
    return result[0];
  }

  async getRecurringTasks(userId: string): Promise<WeeklyTask[]> {
    const results = await db
      .select()
      .from(weeklyTasksTable)
      .where(
        and(
          eq(weeklyTasksTable.userId, userId),
          eq(weeklyTasksTable.isRecurring, true)
        )
      );
    return results;
  }

  async createWeeklyTask(userId: string, task: InsertWeeklyTask): Promise<WeeklyTask> {
    const id = randomUUID();
    const newTask: WeeklyTask = {
      id,
      userId,
      weekStart: task.weekStart,
      title: task.title,
      completed: task.completed ?? false,
      isRecurring: task.isRecurring ?? false,
      carriedOver: task.carriedOver ?? false,
      createdAt: new Date(),
    };
    await db.insert(weeklyTasksTable).values(newTask);
    return newTask;
  }

  async updateWeeklyTask(id: string, updates: Partial<InsertWeeklyTask>): Promise<WeeklyTask> {
    await db
      .update(weeklyTasksTable)
      .set(updates)
      .where(eq(weeklyTasksTable.id, id));
    
    const result = await db
      .select()
      .from(weeklyTasksTable)
      .where(eq(weeklyTasksTable.id, id))
      .limit(1);
    
    if (!result[0]) throw new Error("Weekly task not found");
    return result[0];
  }

  async getPreviousWeekIncompleteTasks(userId: string, currentWeekStart: Date): Promise<WeeklyTask[]> {
    const prevWeekStart = new Date(currentWeekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const prevWeekEnd = new Date(currentWeekStart);
    
    const results = await db
      .select()
      .from(weeklyTasksTable)
      .where(
        and(
          eq(weeklyTasksTable.userId, userId),
          eq(weeklyTasksTable.completed, false),
          eq(weeklyTasksTable.isRecurring, false),
          gte(weeklyTasksTable.weekStart, prevWeekStart),
          lt(weeklyTasksTable.weekStart, prevWeekEnd)
        )
      );
    return results;
  }

  async deduplicateRecurringTasks(userId: string): Promise<number> {
    const allRecurring = await db
      .select()
      .from(weeklyTasksTable)
      .where(
        and(
          eq(weeklyTasksTable.userId, userId),
          eq(weeklyTasksTable.isRecurring, true)
        )
      )
      .orderBy(weeklyTasksTable.createdAt);

    const seen = new Map<string, string>();
    const idsToDelete: string[] = [];

    for (const task of allRecurring) {
      if (seen.has(task.title)) {
        idsToDelete.push(task.id);
      } else {
        seen.set(task.title, task.id);
      }
    }

    if (idsToDelete.length > 0) {
      for (const id of idsToDelete) {
        await db.delete(weeklyTasksTable).where(eq(weeklyTasksTable.id, id));
      }
    }

    return idsToDelete.length;
  }

  async deleteWeeklyTask(id: string): Promise<void> {
    await db.delete(weeklyTasksTable).where(eq(weeklyTasksTable.id, id));
  }

  // Push Subscriptions
  async getPushSubscriptions(userId: string): Promise<PushSubscription[]> {
    const results = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.userId, userId));
    return results;
  }

  async getAllPushSubscriptions(): Promise<PushSubscription[]> {
    const results = await db.select().from(pushSubscriptionsTable);
    return results;
  }

  async createPushSubscription(userId: string, sub: InsertPushSubscription): Promise<PushSubscription> {
    const id = randomUUID();
    const newSub: PushSubscription = {
      id,
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      createdAt: new Date(),
    };
    await db.insert(pushSubscriptionsTable).values(newSub);
    return newSub;
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, endpoint));
  }

  async checkPersistentRateLimit(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const nowDate = new Date(now);
    const nextResetAt = new Date(now + windowMs);
    const [bucket] = await db
      .insert(appRateLimitBucketsTable)
      .values({
        bucketKey: key,
        count: 1,
        resetAt: nextResetAt,
        updatedAt: nowDate,
      })
      .onConflictDoUpdate({
        target: appRateLimitBucketsTable.bucketKey,
        set: {
          count: sql<number>`case when ${appRateLimitBucketsTable.resetAt} <= ${nowDate} then 1 else ${appRateLimitBucketsTable.count} + 1 end`,
          resetAt: sql<Date>`case when ${appRateLimitBucketsTable.resetAt} <= ${nowDate} then ${nextResetAt} else ${appRateLimitBucketsTable.resetAt} end`,
          updatedAt: nowDate,
        },
      })
      .returning({
        count: appRateLimitBucketsTable.count,
        resetAt: appRateLimitBucketsTable.resetAt,
      });

    const count = bucket?.count || 1;
    const resetAt = bucket?.resetAt ? new Date(bucket.resetAt).getTime() : nextResetAt.getTime();
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  }

  // Telegram Config
  async getTelegramConfig(userId: string): Promise<TelegramConfig | undefined> {
    const result = await db
      .select()
      .from(telegramConfigTable)
      .where(eq(telegramConfigTable.userId, userId))
      .limit(1);
    return result[0];
  }

  async getTelegramConfigByChatId(chatId: string): Promise<TelegramConfig | undefined> {
    const result = await db
      .select()
      .from(telegramConfigTable)
      .where(eq(telegramConfigTable.chatId, chatId))
      .limit(1);
    return result[0];
  }

  async getEnabledTelegramConfigs(): Promise<TelegramConfig[]> {
    return db
      .select()
      .from(telegramConfigTable)
      .where(eq(telegramConfigTable.enabled, true));
  }

  async saveTelegramConfig(userId: string, chatId: string): Promise<TelegramConfig> {
    const existingForChat = await this.getTelegramConfigByChatId(chatId);
    if (existingForChat && existingForChat.userId !== userId) {
      await db.delete(telegramConfigTable).where(eq(telegramConfigTable.userId, existingForChat.userId));
    }

    const existing = await this.getTelegramConfig(userId);
    if (existing) {
      const [updated] = await db
        .update(telegramConfigTable)
        .set({ chatId, enabled: true })
        .where(eq(telegramConfigTable.userId, userId))
        .returning();
      return updated;
    }
    const id = randomUUID();
    const newConfig: TelegramConfig = {
      id,
      userId,
      chatId,
      enabled: true,
      createdAt: new Date(),
    };
    await db.insert(telegramConfigTable).values(newConfig);
    return newConfig;
  }

  async updateTelegramConfig(userId: string, enabled: boolean): Promise<TelegramConfig | undefined> {
    const [updated] = await db
      .update(telegramConfigTable)
      .set({ enabled })
      .where(eq(telegramConfigTable.userId, userId))
      .returning();
    return updated;
  }

  async deleteTelegramConfig(userId: string): Promise<void> {
    await db.delete(telegramConfigTable).where(eq(telegramConfigTable.userId, userId));
  }

  async recordTelegramProcessedUpdate(updateId: number): Promise<boolean> {
    const inserted = await db
      .insert(telegramProcessedUpdatesTable)
      .values({ updateId: String(updateId), processedAt: new Date() })
      .onConflictDoNothing()
      .returning({ updateId: telegramProcessedUpdatesTable.updateId });
    return inserted.length > 0;
  }

  async getRevenueStripeEvent(eventId: string): Promise<RevenueStripeEvent | undefined> {
    const [event] = await db
      .select()
      .from(revenueStripeEventsTable)
      .where(eq(revenueStripeEventsTable.eventId, eventId))
      .limit(1);
    return event;
  }

  async createRevenueStripeEvent(event: InsertRevenueStripeEvent): Promise<boolean> {
    const inserted = await db
      .insert(revenueStripeEventsTable)
      .values(event)
      .onConflictDoNothing()
      .returning({ eventId: revenueStripeEventsTable.eventId });
    return inserted.length > 0;
  }

  async updateRevenueStripeEvent(
    eventId: string,
    updates: Partial<Pick<RevenueStripeEvent, "status" | "errorMessage" | "processedAt" | "notifiedAt">>,
  ): Promise<void> {
    await db.update(revenueStripeEventsTable).set(updates).where(eq(revenueStripeEventsTable.eventId, eventId));
  }

  // ==================== INVESTMENTS ====================

  async getInvestments(userId: string): Promise<Investment[]> {
    return await db
      .select()
      .from(investmentsTable)
      .where(eq(investmentsTable.userId, userId))
      .orderBy(desc(investmentsTable.createdAt));
  }

  async getInvestment(id: string): Promise<Investment | undefined> {
    const result = await db
      .select()
      .from(investmentsTable)
      .where(eq(investmentsTable.id, id))
      .limit(1);
    return result[0];
  }

  async createInvestment(userId: string, investment: InsertInvestment): Promise<Investment> {
    const id = randomUUID();
    const now = new Date();
    const newInvestment = {
      id,
      userId,
      symbol: investment.symbol,
      name: investment.name,
      type: investment.type as "stock" | "crypto" | "etf" | "bond" | "fund",
      quantity: investment.quantity,
      avgBuyPrice: investment.avgBuyPrice,
      currency: investment.currency || "USD",
      notes: investment.notes || null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(investmentsTable).values(newInvestment);
    return newInvestment as Investment;
  }

  async updateInvestment(id: string, updates: Partial<InsertInvestment>): Promise<Investment> {
    const updateData: any = { ...updates, updatedAt: new Date() };
    const [updated] = await db
      .update(investmentsTable)
      .set(updateData)
      .where(eq(investmentsTable.id, id))
      .returning();
    return updated;
  }

  async deleteInvestment(id: string): Promise<void> {
    await db.delete(investmentsTable).where(eq(investmentsTable.id, id));
  }

  // ==================== PORTFOLIO CONFIG ====================

  async getPortfolioConfig(userId: string): Promise<{ marginUsed: string; marginTotal: string } | undefined> {
    const result = await db
      .select()
      .from(portfolioConfigTable)
      .where(eq(portfolioConfigTable.userId, userId))
      .limit(1);
    
    if (result.length === 0) {
      return undefined;
    }
    
    return {
      marginUsed: result[0].marginUsed,
      marginTotal: result[0].marginTotal,
    };
  }

  async updatePortfolioConfig(userId: string, marginUsed: string, marginTotal: string): Promise<void> {
    const existing = await this.getPortfolioConfig(userId);
    
    if (existing) {
      await db
        .update(portfolioConfigTable)
        .set({ marginUsed, marginTotal, updatedAt: new Date() })
        .where(eq(portfolioConfigTable.userId, userId));
    } else {
      await db.insert(portfolioConfigTable).values({
        id: randomUUID(),
        userId,
        marginUsed,
        marginTotal,
        updatedAt: new Date(),
      });
    }
  }

  // ==================== TRANSACTIONS ====================

  async getTransactions(userId: string): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.userId, userId))
      .orderBy(desc(transactionsTable.date));
  }

  async createTransaction(userId: string, transaction: InsertTransaction): Promise<Transaction> {
    const id = randomUUID();
    const newTransaction = {
      id,
      userId,
      investmentId: transaction.investmentId || null,
      symbol: transaction.symbol,
      type: transaction.type as "buy" | "sell",
      quantity: transaction.quantity,
      price: transaction.price,
      totalValue: transaction.totalValue,
      currency: transaction.currency || "USD",
      date: transaction.date,
      notes: transaction.notes || null,
      createdAt: new Date(),
    };
    await db.insert(transactionsTable).values(newTransaction);
    return newTransaction as Transaction;
  }

  // ==================== WATCHLIST ====================

  async getWatchlist(userId: string): Promise<WatchlistItem[]> {
    return await db
      .select()
      .from(watchlistTable)
      .where(eq(watchlistTable.userId, userId))
      .orderBy(desc(watchlistTable.createdAt));
  }

  async addToWatchlist(userId: string, item: InsertWatchlistItem): Promise<WatchlistItem> {
    const id = randomUUID();
    const newItem = {
      id,
      userId,
      symbol: item.symbol,
      name: item.name,
      type: item.type as "stock" | "crypto" | "etf" | "bond" | "fund",
      targetPrice: item.targetPrice || null,
      notes: item.notes || null,
      createdAt: new Date(),
    };
    await db.insert(watchlistTable).values(newItem);
    return newItem as WatchlistItem;
  }

  async getWatchlistItem(id: string): Promise<WatchlistItem | undefined> {
    const result = await db
      .select()
      .from(watchlistTable)
      .where(eq(watchlistTable.id, id))
      .limit(1);
    return result[0];
  }

  async removeFromWatchlist(id: string): Promise<void> {
    await db.delete(watchlistTable).where(eq(watchlistTable.id, id));
  }

  // ==================== PRICE ALERTS ====================

  async getPriceAlerts(userId: string): Promise<PriceAlert[]> {
    return await db
      .select()
      .from(priceAlertsTable)
      .where(eq(priceAlertsTable.userId, userId))
      .orderBy(desc(priceAlertsTable.createdAt));
  }

  async createPriceAlert(userId: string, alert: InsertPriceAlert): Promise<PriceAlert> {
    const id = randomUUID();
    const newAlert = {
      id,
      userId,
      symbol: alert.symbol,
      type: alert.type as "stock" | "crypto" | "etf" | "bond" | "fund",
      condition: alert.condition as "above" | "below",
      targetPrice: alert.targetPrice,
      enabled: alert.enabled ?? true,
      triggered: false,
      triggeredAt: null,
      createdAt: new Date(),
    };
    await db.insert(priceAlertsTable).values(newAlert);
    return newAlert as PriceAlert;
  }

  async getPriceAlert(id: string): Promise<PriceAlert | undefined> {
    const result = await db
      .select()
      .from(priceAlertsTable)
      .where(eq(priceAlertsTable.id, id))
      .limit(1);
    return result[0];
  }

  async updatePriceAlert(id: string, updates: Partial<InsertPriceAlert>): Promise<PriceAlert> {
    const updateData: any = { ...updates };
    const [updated] = await db
      .update(priceAlertsTable)
      .set(updateData)
      .where(eq(priceAlertsTable.id, id))
      .returning();
    return updated;
  }

  async deletePriceAlert(id: string): Promise<void> {
    await db.delete(priceAlertsTable).where(eq(priceAlertsTable.id, id));
  }

  // User Profile Data methods
  async getUserProfileData(userId: string): Promise<UserProfileData[]> {
    return db
      .select()
      .from(userProfileDataTable)
      .where(eq(userProfileDataTable.userId, userId))
      .orderBy(desc(userProfileDataTable.updatedAt));
  }

  async getUserProfileDataByCategory(userId: string, category: string): Promise<UserProfileData[]> {
    return db
      .select()
      .from(userProfileDataTable)
      .where(and(
        eq(userProfileDataTable.userId, userId),
        eq(userProfileDataTable.category, category)
      ))
      .orderBy(desc(userProfileDataTable.updatedAt));
  }

  async getUserProfileDataByKey(userId: string, key: string): Promise<UserProfileData | undefined> {
    const [result] = await db
      .select()
      .from(userProfileDataTable)
      .where(and(
        eq(userProfileDataTable.userId, userId),
        eq(userProfileDataTable.key, key)
      ))
      .limit(1);
    return result;
  }

  async saveUserProfileData(userId: string, data: InsertUserProfileData): Promise<UserProfileData> {
    // Check if key already exists for this user
    const existing = await this.getUserProfileDataByKey(userId, data.key);
    if (existing) {
      // Update existing record
      const [updated] = await db
        .update(userProfileDataTable)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(userProfileDataTable.id, existing.id))
        .returning();
      return updated;
    }
    // Create new record
    const id = randomUUID();
    const newData = {
      id,
      userId,
      category: data.category,
      key: data.key,
      value: data.value,
      confidence: data.confidence || "confirmed",
      source: data.source || "conversation",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(userProfileDataTable).values(newData);
    return newData as UserProfileData;
  }

  async updateUserProfileData(id: string, updates: Partial<InsertUserProfileData>): Promise<UserProfileData> {
    const [updated] = await db
      .update(userProfileDataTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(userProfileDataTable.id, id))
      .returning();
    return updated;
  }

  async deleteUserProfileData(id: string): Promise<void> {
    await db.delete(userProfileDataTable).where(eq(userProfileDataTable.id, id));
  }

  // ==================== MONITORED PROJECTS ====================

  async getMonitoredProjects(userId: string): Promise<MonitoredProject[]> {
    return await db
      .select()
      .from(monitoredProjectsTable)
      .where(eq(monitoredProjectsTable.userId, userId))
      .orderBy(desc(monitoredProjectsTable.createdAt));
  }

  async getAllMonitoredProjects(): Promise<MonitoredProject[]> {
    return await db
      .select()
      .from(monitoredProjectsTable)
      .orderBy(desc(monitoredProjectsTable.createdAt));
  }

  async getMonitoredProject(id: string): Promise<MonitoredProject | undefined> {
    const [result] = await db
      .select()
      .from(monitoredProjectsTable)
      .where(eq(monitoredProjectsTable.id, id))
      .limit(1);
    return result;
  }

  async createMonitoredProject(userId: string, project: InsertMonitoredProject): Promise<MonitoredProject> {
    const id = randomUUID();
    const now = new Date();
    const newProject = {
      id,
      userId,
      name: project.name,
      url: project.url,
      description: project.description || null,
      githubRepo: project.githubRepo || null,
      status: "unknown" as const,
      lastCheck: null,
      lastOnline: null,
      responseTime: null,
      checkInterval: project.checkInterval || 5,
      notifyOnDown: project.notifyOnDown ?? true,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(monitoredProjectsTable).values(newProject);
    return newProject as MonitoredProject;
  }

  async updateMonitoredProject(id: string, updates: Partial<MonitoredProject>): Promise<MonitoredProject> {
    const updateData: any = { ...updates, updatedAt: new Date() };
    const [updated] = await db
      .update(monitoredProjectsTable)
      .set(updateData)
      .where(eq(monitoredProjectsTable.id, id))
      .returning();
    return updated;
  }

  async deleteMonitoredProject(id: string): Promise<void> {
    await db.delete(monitoredProjectsTable).where(eq(monitoredProjectsTable.id, id));
  }

  // ==================== HEALTH CHECK LOGS ====================

  async getHealthCheckLogs(projectId: string, limit: number = 100): Promise<HealthCheckLog[]> {
    return await db
      .select()
      .from(healthCheckLogsTable)
      .where(eq(healthCheckLogsTable.projectId, projectId))
      .orderBy(desc(healthCheckLogsTable.checkedAt))
      .limit(limit);
  }

  async createHealthCheckLog(log: InsertHealthCheckLog): Promise<HealthCheckLog> {
    const id = randomUUID();
    const newLog = {
      id,
      projectId: log.projectId,
      status: log.status as "online" | "offline" | "degraded",
      responseTime: log.responseTime || null,
      statusCode: log.statusCode || null,
      errorMessage: log.errorMessage || null,
      checkedAt: new Date(),
    };
    await db.insert(healthCheckLogsTable).values(newLog);
    return newLog as HealthCheckLog;
  }

  // ==================== INCIDENTS ====================

  async getIncidents(projectId: string): Promise<Incident[]> {
    return await db
      .select()
      .from(incidentsTable)
      .where(eq(incidentsTable.projectId, projectId))
      .orderBy(desc(incidentsTable.startedAt));
  }

  async getActiveIncident(projectId: string): Promise<Incident | undefined> {
    const [result] = await db
      .select()
      .from(incidentsTable)
      .where(and(
        eq(incidentsTable.projectId, projectId),
        isNull(incidentsTable.resolvedAt)
      ))
      .limit(1);
    return result;
  }

  async createIncident(incident: InsertIncident): Promise<Incident> {
    const id = randomUUID();
    const newIncident = {
      id,
      projectId: incident.projectId,
      startedAt: incident.startedAt,
      resolvedAt: null,
      duration: null,
      notified: incident.notified ?? false,
      createdAt: new Date(),
    };
    await db.insert(incidentsTable).values(newIncident);
    return newIncident as Incident;
  }

  async resolveIncident(id: string): Promise<Incident> {
    const [incident] = await db
      .select()
      .from(incidentsTable)
      .where(eq(incidentsTable.id, id))
      .limit(1);
    
    if (!incident) throw new Error("Incident not found");
    
    const resolvedAt = new Date();
    const duration = Math.floor((resolvedAt.getTime() - incident.startedAt.getTime()) / 1000);
    
    const [updated] = await db
      .update(incidentsTable)
      .set({ resolvedAt, duration })
      .where(eq(incidentsTable.id, id))
      .returning();
    return updated;
  }

  // ==================== DEVELOPER HEALTH CENTER ====================

  async getAppProjects(userId: string): Promise<AppProject[]> {
    return await db
      .select()
      .from(appProjectsTable)
      .where(eq(appProjectsTable.userId, userId))
      .orderBy(desc(appProjectsTable.updatedAt));
  }

  async getAppProject(id: string): Promise<AppProject | undefined> {
    const [result] = await db.select().from(appProjectsTable).where(eq(appProjectsTable.id, id)).limit(1);
    return result;
  }

  async createAppProject(userId: string, project: InsertAppProject): Promise<AppProject> {
    const id = randomUUID();
    const now = new Date();
    const newProject = {
      ...project,
      id,
      userId,
      description: project.description || null,
      publicUrl: project.publicUrl || null,
      healthUrl: project.healthUrl || null,
      repoOwner: project.repoOwner || null,
      repoName: project.repoName || null,
      githubRepo: project.githubRepo || null,
      deploymentProvider: project.deploymentProvider || null,
      deploymentId: project.deploymentId || null,
      testCommand: project.testCommand || null,
      buildCommand: project.buildCommand || null,
      sentryProjectId: project.sentryProjectId || null,
      stripeAccountId: project.stripeAccountId || null,
      stripeWebhookEndpointId: project.stripeWebhookEndpointId || null,
      logSource: project.logSource || null,
      status: "unknown" as const,
      priority: project.priority || "normal",
      ownerLabel: project.ownerLabel || null,
      tags: project.tags || null,
      lastSeenAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(appProjectsTable).values(newProject as typeof appProjectsTable.$inferInsert);
    return newProject as AppProject;
  }

  async updateAppProject(id: string, updates: Partial<AppProject>): Promise<AppProject> {
    const [updated] = await db
      .update(appProjectsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(appProjectsTable.id, id))
      .returning();
    return updated;
  }

  async getAppHealthChecks(appProjectId: string, limit = 100): Promise<AppHealthCheck[]> {
    return await db
      .select()
      .from(appHealthChecksTable)
      .where(eq(appHealthChecksTable.appProjectId, appProjectId))
      .orderBy(desc(appHealthChecksTable.checkedAt))
      .limit(limit);
  }

  async createAppHealthCheck(check: InsertAppHealthCheck): Promise<AppHealthCheck> {
    const id = randomUUID();
    const newCheck = { ...check, id, checkedAt: new Date() };
    await db.insert(appHealthChecksTable).values(newCheck as typeof appHealthChecksTable.$inferInsert);
    return newCheck as AppHealthCheck;
  }

  async getAppIncidents(userId: string, status?: string): Promise<AppIncident[]> {
    const projects = await this.getAppProjects(userId);
    const projectIds = new Set(projects.map((project) => project.id));
    const incidents = await db.select().from(appIncidentsTable).orderBy(desc(appIncidentsTable.lastSeenAt));
    return incidents.filter((incident) => projectIds.has(incident.appProjectId) && (!status || incident.status === status));
  }

  async getAppIncidentsForProject(appProjectId: string): Promise<AppIncident[]> {
    return await db
      .select()
      .from(appIncidentsTable)
      .where(eq(appIncidentsTable.appProjectId, appProjectId))
      .orderBy(desc(appIncidentsTable.lastSeenAt));
  }

  async getAppIncident(id: string): Promise<AppIncident | undefined> {
    const [result] = await db.select().from(appIncidentsTable).where(eq(appIncidentsTable.id, id)).limit(1);
    return result;
  }

  async createAppIncident(incident: InsertAppIncident): Promise<AppIncident> {
    const id = randomUUID();
    const now = new Date();
    const newIncident = {
      ...incident,
      id,
      summary: incident.summary || null,
      fingerprint: incident.fingerprint || null,
      resolvedAt: null,
      durationSeconds: null,
      relatedErrorEventId: incident.relatedErrorEventId || null,
      relatedPendingActionId: incident.relatedPendingActionId || null,
      relatedPrUrl: incident.relatedPrUrl || null,
      metadata: incident.metadata || null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(appIncidentsTable).values(newIncident as typeof appIncidentsTable.$inferInsert);
    return newIncident as AppIncident;
  }

  async updateAppIncident(id: string, updates: Partial<AppIncident>): Promise<AppIncident> {
    const [updated] = await db
      .update(appIncidentsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(appIncidentsTable.id, id))
      .returning();
    return updated;
  }

  async getAppErrorEvents(appProjectId: string, limit = 100): Promise<AppErrorEvent[]> {
    return await db
      .select()
      .from(appErrorEventsTable)
      .where(eq(appErrorEventsTable.appProjectId, appProjectId))
      .orderBy(desc(appErrorEventsTable.lastSeenAt))
      .limit(limit);
  }

  async getAppErrorEventsForIncident(incidentId: string): Promise<AppErrorEvent[]> {
    return await db
      .select()
      .from(appErrorEventsTable)
      .where(eq(appErrorEventsTable.incidentId, incidentId))
      .orderBy(desc(appErrorEventsTable.lastSeenAt));
  }

  async createAppErrorEvent(event: InsertAppErrorEvent): Promise<AppErrorEvent> {
    const id = randomUUID();
    const newEvent = {
      ...event,
      id,
      incidentId: event.incidentId || null,
      eventKey: event.eventKey || null,
      fingerprint: event.fingerprint || null,
      message: event.message || null,
      stacktrace: event.stacktrace || null,
      requestMethod: event.requestMethod || null,
      requestPath: event.requestPath || null,
      statusCode: event.statusCode || null,
      userImpact: event.userImpact || null,
      metadata: event.metadata || null,
      createdAt: new Date(),
    };
    await db.insert(appErrorEventsTable).values(newEvent as typeof appErrorEventsTable.$inferInsert);
    return newEvent as AppErrorEvent;
  }

  async getAppDailyReports(appProjectId: string, limit = 30): Promise<AppDailyReport[]> {
    return await db
      .select()
      .from(appDailyReportsTable)
      .where(eq(appDailyReportsTable.appProjectId, appProjectId))
      .orderBy(desc(appDailyReportsTable.reportDate))
      .limit(limit);
  }

  async createAppDailyReport(report: InsertAppDailyReport): Promise<AppDailyReport> {
    const id = randomUUID();
    const now = new Date();
    const newReport = {
      ...report,
      id,
      uptimePercentage: report.uptimePercentage || null,
      summary: report.summary || null,
      recommendations: report.recommendations || null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(appDailyReportsTable).values(newReport);
    return newReport as AppDailyReport;
  }

  async getPortfolioHistory(userId: string, days: number = 30): Promise<PortfolioHistory[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const result = await db
      .select()
      .from(portfolioHistoryTable)
      .where(
        and(
          eq(portfolioHistoryTable.userId, userId),
          gte(portfolioHistoryTable.date, startDate)
        )
      )
      .orderBy(portfolioHistoryTable.date);
    return result;
  }

  async createPortfolioSnapshot(userId: string, snapshot: InsertPortfolioHistory): Promise<PortfolioHistory> {
    const id = randomUUID();
    const newSnapshot = { ...snapshot, id, userId };
    await db.insert(portfolioHistoryTable).values(newSnapshot);
    return newSnapshot as PortfolioHistory;
  }

  async getLatestPortfolioSnapshot(userId: string): Promise<PortfolioHistory | undefined> {
    const result = await db
      .select()
      .from(portfolioHistoryTable)
      .where(eq(portfolioHistoryTable.userId, userId))
      .orderBy(desc(portfolioHistoryTable.date))
      .limit(1);
    return result[0];
  }

  // DJ Contact operations
  async getDjContacts(userId: string): Promise<DjContact[]> {
    return db.select().from(djContactsTable).where(eq(djContactsTable.userId, userId));
  }

  async getDjContact(id: string): Promise<DjContact | undefined> {
    const result = await db.select().from(djContactsTable).where(eq(djContactsTable.id, id)).limit(1);
    return result[0];
  }

  async getAvailableDjContacts(userId: string): Promise<DjContact[]> {
    return db.select().from(djContactsTable).where(
      and(eq(djContactsTable.userId, userId), eq(djContactsTable.status, "available"))
    );
  }

  async createDjContact(userId: string, contact: InsertDjContact): Promise<DjContact> {
    const id = randomUUID();
    const newContact = { 
      id, 
      userId, 
      name: contact.name,
      instagramHandle: contact.instagramHandle || null,
      email: contact.email || null,
      genre: contact.genre || null,
      location: contact.location || null,
      lastContacted: contact.lastContacted || null,
      lastPerformance: contact.lastPerformance || null,
      notes: contact.notes || null,
      rating: contact.rating || null,
      status: (contact.status || "available") as "available" | "contacted" | "confirmed" | "declined" | "inactive",
      driveLink: contact.driveLink || null,
      createdAt: new Date(), 
      updatedAt: new Date() 
    };
    await db.insert(djContactsTable).values(newContact);
    return newContact;
  }

  async updateDjContact(id: string, updates: Partial<InsertDjContact>): Promise<DjContact> {
    const updateData: any = { ...updates, updatedAt: new Date() };
    await db.update(djContactsTable).set(updateData).where(eq(djContactsTable.id, id));
    const result = await db.select().from(djContactsTable).where(eq(djContactsTable.id, id)).limit(1);
    if (!result[0]) throw new Error("DJ Contact not found");
    return result[0];
  }

  async deleteDjContact(id: string): Promise<void> {
    await db.delete(djContactsTable).where(eq(djContactsTable.id, id));
  }

  // Radio Template Asset operations
  async getRadioTemplateAssets(userId: string, eventId?: string): Promise<RadioTemplateAsset[]> {
    const conditions = eventId
      ? and(eq(radioTemplateAssetsTable.userId, userId), eq(radioTemplateAssetsTable.eventId, eventId))
      : eq(radioTemplateAssetsTable.userId, userId);

    return db
      .select()
      .from(radioTemplateAssetsTable)
      .where(conditions)
      .orderBy(desc(radioTemplateAssetsTable.eventDate));
  }

  async getRadioTemplateAsset(userId: string, eventId: string, slotHour: number): Promise<RadioTemplateAsset | undefined> {
    const result = await db
      .select()
      .from(radioTemplateAssetsTable)
      .where(
        and(
          eq(radioTemplateAssetsTable.userId, userId),
          eq(radioTemplateAssetsTable.eventId, eventId),
          eq(radioTemplateAssetsTable.slotHour, slotHour)
        )
      )
      .limit(1);

    return result[0];
  }

  async upsertRadioTemplateAsset(userId: string, asset: InsertRadioTemplateAsset): Promise<RadioTemplateAsset> {
    const existing = await this.getRadioTemplateAsset(userId, asset.eventId, asset.slotHour);
    const now = new Date();

    if (existing) {
      return this.updateRadioTemplateAsset(existing.id, {
        ...asset,
        userId,
        updatedAt: now,
      } as Partial<RadioTemplateAsset>);
    }

    const id = randomUUID();
    const newAsset: RadioTemplateAsset = {
      ...asset,
      id,
      userId,
      status: (asset.status || "pending") as "pending" | "generated" | "failed",
      canvaBrandTemplateId: asset.canvaBrandTemplateId || null,
      canvaDesignId: asset.canvaDesignId || null,
      canvaEditUrl: asset.canvaEditUrl || null,
      canvaViewUrl: asset.canvaViewUrl || null,
      driveFileId: asset.driveFileId || null,
      driveLink: asset.driveLink || null,
      errorMessage: asset.errorMessage || null,
      lastGeneratedAt: asset.lastGeneratedAt || null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(radioTemplateAssetsTable).values(newAsset);
    return newAsset as RadioTemplateAsset;
  }

  async updateRadioTemplateAsset(id: string, updates: Partial<RadioTemplateAsset>): Promise<RadioTemplateAsset> {
    await db
      .update(radioTemplateAssetsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(radioTemplateAssetsTable.id, id));

    const result = await db
      .select()
      .from(radioTemplateAssetsTable)
      .where(eq(radioTemplateAssetsTable.id, id))
      .limit(1);

    if (!result[0]) throw new Error("Radio template asset not found");
    return result[0];
  }

  async getCanvaOAuthToken(userId: string): Promise<CanvaOAuthToken | undefined> {
    const [token] = await db
      .select()
      .from(canvaOAuthTokensTable)
      .where(eq(canvaOAuthTokensTable.userId, userId))
      .orderBy(desc(canvaOAuthTokensTable.updatedAt))
      .limit(1);

    return token;
  }

  async saveCanvaOAuthToken(userId: string, token: InsertCanvaOAuthToken): Promise<CanvaOAuthToken> {
    const existing = await this.getCanvaOAuthToken(userId);
    const now = new Date();

    if (existing) {
      const [updated] = await db
        .update(canvaOAuthTokensTable)
        .set({ ...token, userId, updatedAt: now })
        .where(eq(canvaOAuthTokensTable.id, existing.id))
        .returning();
      return updated;
    }

    const newToken: CanvaOAuthToken = {
      ...token,
      id: randomUUID(),
      userId,
      scope: token.scope || null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(canvaOAuthTokensTable).values(newToken);
    return newToken;
  }

  async getGoogleDriveOAuthToken(userId: string): Promise<GoogleDriveOAuthToken | undefined> {
    const [token] = await db
      .select()
      .from(googleDriveOAuthTokensTable)
      .where(eq(googleDriveOAuthTokensTable.userId, userId))
      .orderBy(desc(googleDriveOAuthTokensTable.updatedAt))
      .limit(1);

    return token;
  }

  async saveGoogleDriveOAuthToken(userId: string, token: InsertGoogleDriveOAuthToken): Promise<GoogleDriveOAuthToken> {
    const existing = await this.getGoogleDriveOAuthToken(userId);
    const now = new Date();

    if (existing) {
      const [updated] = await db
        .update(googleDriveOAuthTokensTable)
        .set({ ...token, userId, updatedAt: now })
        .where(eq(googleDriveOAuthTokensTable.id, existing.id))
        .returning();
      return updated;
    }

    const newToken: GoogleDriveOAuthToken = {
      ...token,
      id: randomUUID(),
      userId,
      scope: token.scope || null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(googleDriveOAuthTokensTable).values(newToken);
    return newToken;
  }

  // Agent Action operations
  async getAgentActions(userId: string): Promise<AgentAction[]> {
    return db.select().from(agentActionsTable).where(eq(agentActionsTable.userId, userId)).orderBy(desc(agentActionsTable.createdAt));
  }

  async getPendingAgentActions(userId: string): Promise<AgentAction[]> {
    return db.select().from(agentActionsTable).where(
      and(eq(agentActionsTable.userId, userId), eq(agentActionsTable.status, "pending"))
    );
  }

  async createAgentAction(userId: string, action: InsertAgentAction): Promise<AgentAction> {
    const id = randomUUID();
    const newAction = { 
      id, 
      userId, 
      type: action.type as "radio_dj_search" | "radio_message_draft" | "portfolio_analysis" | "portfolio_rebalance" | "task_reminder" | "weekly_report",
      status: "pending" as "pending" | "in_progress" | "completed" | "failed" | "needs_approval",
      description: action.description,
      input: action.input || null,
      output: action.output || null,
      requiresApproval: action.requiresApproval || false,
      approvedAt: null,
      executedAt: null,
      scheduledFor: action.scheduledFor || null,
      createdAt: new Date() 
    };
    await db.insert(agentActionsTable).values(newAction);
    return newAction;
  }

  async updateAgentAction(id: string, updates: Partial<AgentAction>): Promise<AgentAction> {
    await db.update(agentActionsTable).set(updates).where(eq(agentActionsTable.id, id));
    const result = await db.select().from(agentActionsTable).where(eq(agentActionsTable.id, id)).limit(1);
    if (!result[0]) throw new Error("Agent Action not found");
    return result[0];
  }

  // Trust & Control operations
  async getAuditLogs(userId: string, limit = 100): Promise<AuditLog[]> {
    return db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.userId, userId))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit);
  }

  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const id = randomUUID();
    const newLog = {
      ...log,
      id,
      actorId: log.actorId || null,
      resourceType: log.resourceType || null,
      resourceId: log.resourceId || null,
      requestId: log.requestId || null,
      pendingActionId: log.pendingActionId || null,
      metadata: log.metadata || null,
      errorMessage: log.errorMessage || null,
      createdAt: new Date(),
    };
    await db.insert(auditLogsTable).values(newLog as typeof auditLogsTable.$inferInsert);
    return newLog as AuditLog;
  }

  async getPendingActions(userId: string): Promise<PendingAction[]> {
    return db
      .select()
      .from(pendingActionsTable)
      .where(eq(pendingActionsTable.userId, userId))
      .orderBy(desc(pendingActionsTable.createdAt));
  }

  async getPendingAction(id: string): Promise<PendingAction | undefined> {
    const result = await db.select().from(pendingActionsTable).where(eq(pendingActionsTable.id, id)).limit(1);
    return result[0];
  }

  async createPendingAction(userId: string, action: InsertPendingAction): Promise<PendingAction> {
    const id = randomUUID();
    const newAction = {
      ...action,
      id,
      userId,
      createdByActorId: action.createdByActorId || null,
      resourceId: action.resourceId || null,
      riskLevel: action.riskLevel || "medium",
      permissionLevelRequired: action.permissionLevelRequired || "execute_after_approval",
      status: "pending" as const,
      input: action.input || null,
      proposedChanges: action.proposedChanges || null,
      editedInput: null,
      executionResult: null,
      approvalReason: null,
      rejectionReason: null,
      snoozedUntil: null,
      expiresAt: action.expiresAt || null,
      approvedBy: null,
      approvedAt: null,
      executedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(pendingActionsTable).values(newAction as typeof pendingActionsTable.$inferInsert);
    await db.insert(pendingActionEventsTable).values({
      id: randomUUID(),
      pendingActionId: id,
      userId,
      actorType: action.createdByActorType,
      actorId: action.createdByActorId || null,
      eventType: "created",
      previousStatus: null,
      nextStatus: "pending",
      note: null,
      metadata: {
        actionType: action.actionType,
        resourceType: action.resourceType,
        resourceId: action.resourceId || null,
        riskLevel: newAction.riskLevel,
        permissionLevelRequired: newAction.permissionLevelRequired,
      },
      createdAt: new Date(),
    } as typeof pendingActionEventsTable.$inferInsert);
    return newAction as PendingAction;
  }

  async updatePendingAction(id: string, updates: Partial<PendingAction>): Promise<PendingAction> {
    await db.update(pendingActionsTable).set({ ...updates, updatedAt: new Date() }).where(eq(pendingActionsTable.id, id));
    const result = await db.select().from(pendingActionsTable).where(eq(pendingActionsTable.id, id)).limit(1);
    if (!result[0]) throw new Error("Pending Action not found");
    return result[0];
  }

  async getPendingActionEvents(pendingActionId: string): Promise<PendingActionEvent[]> {
    return db
      .select()
      .from(pendingActionEventsTable)
      .where(eq(pendingActionEventsTable.pendingActionId, pendingActionId))
      .orderBy(desc(pendingActionEventsTable.createdAt));
  }

  async getApprovalHistory(userId: string, limit = 100): Promise<PendingActionEvent[]> {
    return db
      .select()
      .from(pendingActionEventsTable)
      .where(eq(pendingActionEventsTable.userId, userId))
      .orderBy(desc(pendingActionEventsTable.createdAt))
      .limit(limit);
  }

  async createPendingActionEvent(event: InsertPendingActionEvent): Promise<PendingActionEvent> {
    const id = randomUUID();
    const newEvent = {
      ...event,
      id,
      actorId: event.actorId || null,
      previousStatus: event.previousStatus || null,
      nextStatus: event.nextStatus || null,
      note: event.note || null,
      metadata: event.metadata || null,
      createdAt: new Date(),
    };
    await db.insert(pendingActionEventsTable).values(newEvent as typeof pendingActionEventsTable.$inferInsert);
    return newEvent as PendingActionEvent;
  }

  async getAssistantPermissions(userId: string): Promise<AssistantPermission[]> {
    return db.select().from(assistantPermissionsTable).where(eq(assistantPermissionsTable.userId, userId));
  }

  async upsertAssistantPermission(userId: string, permission: InsertAssistantPermission): Promise<AssistantPermission> {
    const existing = await db
      .select()
      .from(assistantPermissionsTable)
      .where(and(eq(assistantPermissionsTable.userId, userId), eq(assistantPermissionsTable.scope, permission.scope)))
      .limit(1);

    if (existing[0]) {
      await db
        .update(assistantPermissionsTable)
        .set({ ...permission, updatedAt: new Date() } as Partial<typeof assistantPermissionsTable.$inferInsert>)
        .where(eq(assistantPermissionsTable.id, existing[0].id));
      const result = await db.select().from(assistantPermissionsTable).where(eq(assistantPermissionsTable.id, existing[0].id)).limit(1);
      return result[0];
    }

    const id = randomUUID();
    const newPermission = {
      ...permission,
      id,
      userId,
      permissionLevel: permission.permissionLevel || "execute_after_approval",
      riskLimit: permission.riskLimit || "medium",
      enabled: permission.enabled ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(assistantPermissionsTable).values(newPermission as typeof assistantPermissionsTable.$inferInsert);
    return newPermission as AssistantPermission;
  }

  // Automation Manager operations
  async getAutomationDefinitions(userId: string): Promise<AutomationDefinition[]> {
    return db
      .select()
      .from(automationDefinitionsTable)
      .where(eq(automationDefinitionsTable.ownerUserId, userId))
      .orderBy(desc(automationDefinitionsTable.updatedAt));
  }

  async getAutomationDefinition(id: string): Promise<AutomationDefinition | undefined> {
    const result = await db.select().from(automationDefinitionsTable).where(eq(automationDefinitionsTable.id, id)).limit(1);
    return result[0];
  }

  async createAutomationDefinition(userId: string, automation: InsertAutomationDefinition): Promise<AutomationDefinition> {
    const id = randomUUID();
    const newAutomation = {
      ...automation,
      id,
      ownerUserId: userId,
      description: automation.description || null,
      assignedAgentId: automation.assignedAgentId || null,
      schedule: automation.schedule || null,
      timezone: automation.timezone || "America/New_York",
      status: automation.status || "active",
      permissionLevel: automation.permissionLevel || "execute_after_approval",
      requiresApproval: automation.requiresApproval ?? false,
      nextRunAt: automation.nextRunAt || null,
      lastRunAt: null,
      lastStatus: null,
      failureCount: 0,
      costEstimate: automation.costEstimate || null,
      metadata: automation.metadata || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(automationDefinitionsTable).values(newAutomation as typeof automationDefinitionsTable.$inferInsert);
    return newAutomation as AutomationDefinition;
  }

  async updateAutomationDefinition(id: string, updates: Partial<AutomationDefinition>): Promise<AutomationDefinition> {
    await db.update(automationDefinitionsTable).set({ ...updates, updatedAt: new Date() }).where(eq(automationDefinitionsTable.id, id));
    const result = await db.select().from(automationDefinitionsTable).where(eq(automationDefinitionsTable.id, id)).limit(1);
    if (!result[0]) throw new Error("Automation definition not found");
    return result[0];
  }

  async getAutomationRuns(userId: string, automationId?: string, limit = 100): Promise<AutomationRun[]> {
    const whereClause = automationId
      ? and(eq(automationRunsTable.ownerUserId, userId), eq(automationRunsTable.automationId, automationId))
      : eq(automationRunsTable.ownerUserId, userId);

    return db
      .select()
      .from(automationRunsTable)
      .where(whereClause)
      .orderBy(desc(automationRunsTable.startedAt))
      .limit(limit);
  }

  async createAutomationRun(run: InsertAutomationRun): Promise<AutomationRun> {
    const id = randomUUID();
    const newRun = {
      ...run,
      id,
      finishedAt: run.finishedAt || null,
      resultSummary: run.resultSummary || null,
      errorMessage: run.errorMessage || null,
      costEstimate: run.costEstimate || null,
      pendingActionId: run.pendingActionId || null,
      auditLogId: run.auditLogId || null,
      metadata: run.metadata || null,
      createdAt: new Date(),
    };
    await db.insert(automationRunsTable).values(newRun as typeof automationRunsTable.$inferInsert);

    await db.update(automationDefinitionsTable)
      .set({
        lastRunAt: run.startedAt,
        lastStatus: run.status as typeof automationDefinitionsTable.$inferInsert["lastStatus"],
        failureCount: run.status === "failed" ? sql`${automationDefinitionsTable.failureCount} + 1` : 0,
        ...(run.triggeredBy === "scheduler" ? {nextRunAt:sql`CASE WHEN ${automationDefinitionsTable.nextRunAt} <= ${run.startedAt} THEN NULL ELSE ${automationDefinitionsTable.nextRunAt} END`} : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(automationDefinitionsTable.id, run.automationId),eq(automationDefinitionsTable.ownerUserId,run.ownerUserId),
        sql`(${automationDefinitionsTable.lastRunAt} IS NULL OR ${automationDefinitionsTable.lastRunAt} <= ${run.startedAt})`));

    return newRun as AutomationRun;
  }

  // DJ Message Template operations
  async getDjMessageTemplates(userId: string): Promise<DjMessageTemplate[]> {
    return db.select().from(djMessageTemplatesTable).where(eq(djMessageTemplatesTable.userId, userId));
  }

  async createDjMessageTemplate(userId: string, template: InsertDjMessageTemplate): Promise<DjMessageTemplate> {
    const id = randomUUID();
    const newTemplate = { ...template, id, userId, createdAt: new Date() };
    await db.insert(djMessageTemplatesTable).values(newTemplate);
    return newTemplate as DjMessageTemplate;
  }

  async getDefaultDjMessageTemplate(userId: string): Promise<DjMessageTemplate | undefined> {
    const result = await db.select().from(djMessageTemplatesTable).where(
      and(eq(djMessageTemplatesTable.userId, userId), eq(djMessageTemplatesTable.isDefault, true))
    ).limit(1);
    return result[0];
  }

  async getScheduledReminders(userId: string): Promise<ScheduledReminder[]> {
    return await db.select().from(scheduledRemindersTable).where(eq(scheduledRemindersTable.userId, userId));
  }

  async getActiveScheduledReminders(): Promise<ScheduledReminder[]> {
    return await db.select().from(scheduledRemindersTable).where(eq(scheduledRemindersTable.isActive, true));
  }

  async createScheduledReminder(userId: string, reminder: InsertScheduledReminder): Promise<ScheduledReminder> {
    const id = randomUUID();
    const newReminder = { ...reminder, id, userId, createdAt: new Date() };
    await db.insert(scheduledRemindersTable).values(newReminder);
    return newReminder as ScheduledReminder;
  }

  async updateScheduledReminder(id: string, updates: Partial<ScheduledReminder>): Promise<ScheduledReminder> {
    await db.update(scheduledRemindersTable).set(updates).where(eq(scheduledRemindersTable.id, id));
    const result = await db.select().from(scheduledRemindersTable).where(eq(scheduledRemindersTable.id, id)).limit(1);
    return result[0];
  }

  async deleteScheduledReminder(id: string): Promise<void> {
    await db.delete(scheduledRemindersTable).where(eq(scheduledRemindersTable.id, id));
  }
}

export const storage = new DatabaseStorage();
