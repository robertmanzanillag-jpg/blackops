import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, jsonb, serial, integer, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Chat conversations for AI assistant
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  date: timestamp("date").notNull(),
  endDate: timestamp("end_date"),
  priority: text("priority").notNull().default("normal"),
  completed: boolean("completed").notNull().default(false),
  type: text("type").notNull().default("task"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  externalId: text("external_id"),
  externalSource: text("external_source"),
  originalDate: timestamp("original_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;

// Weekly Reflection/Summary schema
export const weeklySummaries = pgTable("weekly_summaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  weekStart: timestamp("week_start").notNull(), // Monday of the week
  gratitude: text("gratitude").array(), // 3+ things grateful for
  completedAllTasks: boolean("completed_all_tasks"),
  tasksIncompleteReason: text("tasks_incomplete_reason"),
  talkedToFamily: boolean("talked_to_family"),
  wentOutWithFriend: boolean("went_out_with_friend"),
  learnedThisWeek: text("learned_this_week"),
  exercisedThreePlus: boolean("exercised_three_plus"),
  helpedSomeone: boolean("helped_someone"),
  biggestAchievement: text("biggest_achievement"),
  hardestTask: text("hardest_task"),
  improvementsForNextWeek: text("improvements_for_next_week"),
  pendingTasks: text("pending_tasks"),
  mostProductiveThing: text("most_productive_thing"),
  nextWeekGoal: text("next_week_goal"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWeeklySummarySchema = createInsertSchema(weeklySummaries).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWeeklySummary = z.infer<typeof insertWeeklySummarySchema>;
export type WeeklySummary = typeof weeklySummaries.$inferSelect;

// Monthly Goals schema
export const monthlyGoals = pgTable("monthly_goals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  month: timestamp("month").notNull(), // First day of the month
  title: text("title").notNull(),
  completed: boolean("completed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertMonthlyGoalSchema = createInsertSchema(monthlyGoals).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type InsertMonthlyGoal = z.infer<typeof insertMonthlyGoalSchema>;
export type MonthlyGoal = typeof monthlyGoals.$inferSelect;

// Yearly Goals schema
export const yearlyGoals = pgTable("yearly_goals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  year: text("year").notNull(), // e.g., "2026"
  title: text("title").notNull(),
  completed: boolean("completed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertYearlyGoalSchema = createInsertSchema(yearlyGoals).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type InsertYearlyGoal = z.infer<typeof insertYearlyGoalSchema>;
export type YearlyGoal = typeof yearlyGoals.$inferSelect;

// Weekly Tasks (quick tasks not on calendar)
export const weeklyTasks = pgTable("weekly_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  weekStart: timestamp("week_start").notNull(),
  title: text("title").notNull(),
  completed: boolean("completed").notNull().default(false),
  isRecurring: boolean("is_recurring").notNull().default(false),
  carriedOver: boolean("carried_over").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWeeklyTaskSchema = createInsertSchema(weeklyTasks).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type InsertWeeklyTask = z.infer<typeof insertWeeklyTaskSchema>;
export type WeeklyTask = typeof weeklyTasks.$inferSelect;

// Push Subscriptions for notifications
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

export const appRateLimitBuckets = pgTable("app_rate_limit_buckets", {
  bucketKey: text("bucket_key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AppRateLimitBucket = typeof appRateLimitBuckets.$inferSelect;

// Telegram configuration for notifications
export const telegramConfig = pgTable("telegram_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  chatId: text("chat_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTelegramConfigSchema = createInsertSchema(telegramConfig).omit({
  id: true,
  createdAt: true,
});

export type InsertTelegramConfig = z.infer<typeof insertTelegramConfigSchema>;
export type TelegramConfig = typeof telegramConfig.$inferSelect;

export const telegramProcessedUpdates = pgTable("telegram_processed_updates", {
  updateId: text("update_id").primaryKey(),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

export type TelegramProcessedUpdate = typeof telegramProcessedUpdates.$inferSelect;

// Durable idempotency and delivery state for Robert Websites Stripe events.
export const revenueStripeEvents = pgTable("revenue_stripe_events", {
  eventId: text("event_id").primaryKey(),
  accountId: text("account_id").notNull(),
  eventType: text("event_type").notNull(),
  objectId: text("object_id").notNull(),
  paymentIntentId: text("payment_intent_id"),
  opportunityId: text("opportunity_id"),
  ownerUserId: varchar("owner_user_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull().default("processing"),
  errorMessage: text("error_message"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
  notifiedAt: timestamp("notified_at"),
}, (table) => [
  uniqueIndex("revenue_stripe_payment_intent_unique").on(table.paymentIntentId),
]);

export type RevenueStripeEvent = typeof revenueStripeEvents.$inferSelect;
export type InsertRevenueStripeEvent = typeof revenueStripeEvents.$inferInsert;

// ==================== FINANCE MODULE ====================

// Investment types
export type InvestmentType = "stock" | "crypto" | "etf" | "bond" | "fund";

// User investments/holdings
export const investments = pgTable("investments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().$type<InvestmentType>(),
  quantity: text("quantity").notNull(),
  avgBuyPrice: text("avg_buy_price").notNull(),
  currency: text("currency").notNull().default("USD"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertInvestmentSchema = createInsertSchema(investments).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export type Investment = typeof investments.$inferSelect;
export type InsertInvestment = z.infer<typeof insertInvestmentSchema>;

// Portfolio configuration (margin, settings)
export const portfolioConfig = pgTable("portfolio_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  marginUsed: text("margin_used").notNull().default("0"),
  marginTotal: text("margin_total").notNull().default("0"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPortfolioConfigSchema = createInsertSchema(portfolioConfig).omit({
  id: true,
  userId: true,
  updatedAt: true,
});

export type PortfolioConfig = typeof portfolioConfig.$inferSelect;
export type InsertPortfolioConfig = z.infer<typeof insertPortfolioConfigSchema>;

// Transaction history
export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  investmentId: varchar("investment_id").references(() => investments.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  type: text("type").notNull().$type<"buy" | "sell">(),
  quantity: text("quantity").notNull(),
  price: text("price").notNull(),
  totalValue: text("total_value").notNull(),
  currency: text("currency").notNull().default("USD"),
  date: timestamp("date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;

// Watchlist
export const watchlist = pgTable("watchlist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().$type<InvestmentType>(),
  targetPrice: text("target_price"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWatchlistSchema = createInsertSchema(watchlist).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type WatchlistItem = typeof watchlist.$inferSelect;
export type InsertWatchlistItem = z.infer<typeof insertWatchlistSchema>;

// Price alerts
export const priceAlerts = pgTable("price_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol").notNull(),
  type: text("type").notNull().$type<InvestmentType>(),
  condition: text("condition").notNull().$type<"above" | "below">(),
  targetPrice: text("target_price").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  triggered: boolean("triggered").notNull().default(false),
  triggeredAt: timestamp("triggered_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPriceAlertSchema = createInsertSchema(priceAlerts).omit({
  id: true,
  userId: true,
  triggered: true,
  triggeredAt: true,
  createdAt: true,
});

export type PriceAlert = typeof priceAlerts.$inferSelect;
export type InsertPriceAlert = z.infer<typeof insertPriceAlertSchema>;

// Portfolio history for tracking daily values
export const portfolioHistory = pgTable("portfolio_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  date: timestamp("date").notNull(),
  totalValue: text("total_value").notNull(),
  stocksValue: text("stocks_value").notNull().default("0"),
  etfsValue: text("etfs_value").notNull().default("0"),
  cryptoValue: text("crypto_value").notNull().default("0"),
  bondsValue: text("bonds_value").notNull().default("0"),
  dailyChange: text("daily_change"),
  dailyChangePercent: text("daily_change_percent"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPortfolioHistorySchema = createInsertSchema(portfolioHistory).omit({
  id: true,
  createdAt: true,
});

export type PortfolioHistory = typeof portfolioHistory.$inferSelect;
export type InsertPortfolioHistory = z.infer<typeof insertPortfolioHistorySchema>;

// User Profile Data - stores personal information the assistant learns about the user
export const userProfileData = pgTable("user_profile_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  category: text("category").notNull(), // e.g., "personal", "work", "preferences", "family", "hobbies"
  key: text("key").notNull(), // e.g., "nombre", "cumpleaños", "trabajo", "pareja"
  value: text("value").notNull(), // the actual information
  confidence: text("confidence").default("confirmed"), // "confirmed" or "inferred"
  source: text("source").default("conversation"), // "conversation", "manual", "system"
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserProfileDataSchema = createInsertSchema(userProfileData).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type UserProfileData = typeof userProfileData.$inferSelect;
export type InsertUserProfileData = z.infer<typeof insertUserProfileDataSchema>;

// ==================== PROJECT MONITORING ====================

// Monitored projects/deployments
export const monitoredProjects = pgTable("monitored_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  description: text("description"),
  githubRepo: text("github_repo"), // e.g., "username/repo-name"
  status: text("status").notNull().default("unknown").$type<"online" | "offline" | "unknown" | "degraded">(),
  lastCheck: timestamp("last_check"),
  lastOnline: timestamp("last_online"),
  responseTime: integer("response_time"), // in milliseconds
  checkInterval: integer("check_interval").notNull().default(5), // in minutes
  notifyOnDown: boolean("notify_on_down").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertMonitoredProjectSchema = createInsertSchema(monitoredProjects).omit({
  id: true,
  userId: true,
  status: true,
  lastCheck: true,
  lastOnline: true,
  responseTime: true,
  createdAt: true,
  updatedAt: true,
});

export type MonitoredProject = typeof monitoredProjects.$inferSelect;
export type InsertMonitoredProject = z.infer<typeof insertMonitoredProjectSchema>;

// Health check history/logs
export const healthCheckLogs = pgTable("health_check_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => monitoredProjects.id, { onDelete: "cascade" }),
  status: text("status").notNull().$type<"online" | "offline" | "degraded">(),
  responseTime: integer("response_time"), // in milliseconds
  statusCode: integer("status_code"),
  errorMessage: text("error_message"),
  checkedAt: timestamp("checked_at").defaultNow(),
});

export const insertHealthCheckLogSchema = createInsertSchema(healthCheckLogs).omit({
  id: true,
  checkedAt: true,
});

export type HealthCheckLog = typeof healthCheckLogs.$inferSelect;
export type InsertHealthCheckLog = z.infer<typeof insertHealthCheckLogSchema>;

// Downtime incidents
export const incidents = pgTable("incidents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => monitoredProjects.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at").notNull(),
  resolvedAt: timestamp("resolved_at"),
  duration: integer("duration"), // in seconds
  notified: boolean("notified").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertIncidentSchema = createInsertSchema(incidents).omit({
  id: true,
  resolvedAt: true,
  duration: true,
  createdAt: true,
});

export type Incident = typeof incidents.$inferSelect;
export type InsertIncident = z.infer<typeof insertIncidentSchema>;

// ==================== DEVELOPER HEALTH CENTER ====================

export type AppEnvironment = "production" | "staging" | "dev";
export type AppProjectStatus = "healthy" | "degraded" | "down" | "unknown";
export type AppPriority = "low" | "normal" | "high" | "critical";
export type AppHealthCheckType = "uptime" | "health_endpoint" | "api_probe" | "webhook_probe";
export type AppHealthCheckStatus = "ok" | "degraded" | "failed";
export type AppIncidentSource = "uptime" | "sentry" | "logs" | "stripe" | "github" | "deploy" | "api";
export type AppIncidentSeverity = "info" | "warning" | "high" | "critical";
export type AppIncidentStatus = "open" | "investigating" | "pending_action" | "resolved" | "ignored";
export type AppErrorEventSource = "sentry" | "server_log" | "failed_api" | "stripe_webhook" | "github" | "deploy";
export type AppErrorEventLevel = "debug" | "info" | "warning" | "error" | "fatal";

export const appProjects = pgTable("app_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  environment: text("environment").notNull().default("production").$type<AppEnvironment>(),
  publicUrl: text("public_url"),
  healthUrl: text("health_url"),
  repoOwner: text("repo_owner"),
  repoName: text("repo_name"),
  githubRepo: text("github_repo"),
  deploymentProvider: text("deployment_provider"),
  deploymentId: text("deployment_id"),
  testCommand: text("test_command"),
  buildCommand: text("build_command"),
  sentryProjectId: text("sentry_project_id"),
  stripeAccountId: text("stripe_account_id"),
  stripeWebhookEndpointId: text("stripe_webhook_endpoint_id"),
  logSource: text("log_source"),
  status: text("status").notNull().default("unknown").$type<AppProjectStatus>(),
  priority: text("priority").notNull().default("normal").$type<AppPriority>(),
  ownerLabel: text("owner_label"),
  tags: jsonb("tags"),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAppProjectSchema = createInsertSchema(appProjects).omit({
  id: true,
  userId: true,
  status: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
});

export type AppProject = typeof appProjects.$inferSelect;
export type InsertAppProject = z.infer<typeof insertAppProjectSchema>;

export const appHealthChecks = pgTable("app_health_checks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  appProjectId: varchar("app_project_id").notNull().references(() => appProjects.id, { onDelete: "cascade" }),
  checkType: text("check_type").notNull().$type<AppHealthCheckType>(),
  status: text("status").notNull().$type<AppHealthCheckStatus>(),
  responseTimeMs: integer("response_time_ms"),
  statusCode: integer("status_code"),
  checkedUrl: text("checked_url"),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata"),
  checkedAt: timestamp("checked_at").defaultNow(),
});

export const insertAppHealthCheckSchema = createInsertSchema(appHealthChecks).omit({
  id: true,
  checkedAt: true,
});

export type AppHealthCheck = typeof appHealthChecks.$inferSelect;
export type InsertAppHealthCheck = z.infer<typeof insertAppHealthCheckSchema>;

export const appIncidents = pgTable("app_incidents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  appProjectId: varchar("app_project_id").notNull().references(() => appProjects.id, { onDelete: "cascade" }),
  source: text("source").notNull().$type<AppIncidentSource>(),
  severity: text("severity").notNull().default("warning").$type<AppIncidentSeverity>(),
  status: text("status").notNull().default("open").$type<AppIncidentStatus>(),
  title: text("title").notNull(),
  summary: text("summary"),
  fingerprint: text("fingerprint"),
  firstSeenAt: timestamp("first_seen_at").notNull(),
  lastSeenAt: timestamp("last_seen_at").notNull(),
  resolvedAt: timestamp("resolved_at"),
  durationSeconds: integer("duration_seconds"),
  relatedErrorEventId: varchar("related_error_event_id"),
  relatedPendingActionId: varchar("related_pending_action_id"),
  relatedPrUrl: text("related_pr_url"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAppIncidentSchema = createInsertSchema(appIncidents).omit({
  id: true,
  resolvedAt: true,
  durationSeconds: true,
  createdAt: true,
  updatedAt: true,
});

export type AppIncident = typeof appIncidents.$inferSelect;
export type InsertAppIncident = z.infer<typeof insertAppIncidentSchema>;

export const appErrorEvents = pgTable("app_error_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  appProjectId: varchar("app_project_id").notNull().references(() => appProjects.id, { onDelete: "cascade" }),
  incidentId: varchar("incident_id").references(() => appIncidents.id, { onDelete: "set null" }),
  source: text("source").notNull().$type<AppErrorEventSource>(),
  level: text("level").notNull().default("error").$type<AppErrorEventLevel>(),
  eventKey: text("event_key"),
  fingerprint: text("fingerprint"),
  title: text("title").notNull(),
  message: text("message"),
  stacktrace: text("stacktrace"),
  requestMethod: text("request_method"),
  requestPath: text("request_path"),
  statusCode: integer("status_code"),
  userImpact: text("user_impact"),
  count: integer("count").notNull().default(1),
  firstSeenAt: timestamp("first_seen_at").notNull(),
  lastSeenAt: timestamp("last_seen_at").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAppErrorEventSchema = createInsertSchema(appErrorEvents).omit({
  id: true,
  createdAt: true,
});

export type AppErrorEvent = typeof appErrorEvents.$inferSelect;
export type InsertAppErrorEvent = z.infer<typeof insertAppErrorEventSchema>;

export const appDailyReports = pgTable("app_daily_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  appProjectId: varchar("app_project_id").notNull().references(() => appProjects.id, { onDelete: "cascade" }),
  reportDate: timestamp("report_date").notNull(),
  uptimePercentage: text("uptime_percentage"),
  checksTotal: integer("checks_total").notNull().default(0),
  checksFailed: integer("checks_failed").notNull().default(0),
  incidentsOpened: integer("incidents_opened").notNull().default(0),
  incidentsResolved: integer("incidents_resolved").notNull().default(0),
  sentryErrors: integer("sentry_errors").notNull().default(0),
  failedApiRequests: integer("failed_api_requests").notNull().default(0),
  stripeWebhookFailures: integer("stripe_webhook_failures").notNull().default(0),
  githubOpenIssues: integer("github_open_issues").notNull().default(0),
  githubOpenPrs: integer("github_open_prs").notNull().default(0),
  deploymentsCount: integer("deployments_count").notNull().default(0),
  deploymentFailures: integer("deployment_failures").notNull().default(0),
  summary: text("summary"),
  recommendations: jsonb("recommendations"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAppDailyReportSchema = createInsertSchema(appDailyReports).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AppDailyReport = typeof appDailyReports.$inferSelect;
export type InsertAppDailyReport = z.infer<typeof insertAppDailyReportSchema>;

// GitHub connection info (for when user connects later)
export const githubConnections = pgTable("github_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  accessToken: text("access_token"),
  username: text("username"),
  connected: boolean("connected").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type GitHubConnection = typeof githubConnections.$inferSelect;

// ==================== DJ CONTACTS (for Radio automation) ====================

export const djContacts = pgTable("dj_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  instagramHandle: text("instagram_handle"),
  email: text("email"),
  genre: text("genre"), // e.g., "techno", "house", "ambient"
  location: text("location"),
  lastContacted: timestamp("last_contacted"),
  lastPerformance: timestamp("last_performance"),
  notes: text("notes"),
  rating: integer("rating"), // 1-5 stars based on performance
  status: text("status").default("available").$type<"available" | "contacted" | "confirmed" | "declined" | "inactive">(),
  driveLink: text("drive_link"), // link to their music/sets
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDjContactSchema = createInsertSchema(djContacts).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export type DjContact = typeof djContacts.$inferSelect;
export type InsertDjContact = z.infer<typeof insertDjContactSchema>;

// ==================== RADIO TEMPLATE ASSETS ====================

export const radioTemplateAssets = pgTable("radio_template_assets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  eventId: text("event_id").notNull(),
  eventDate: timestamp("event_date").notNull(),
  slotHour: integer("slot_hour").notNull(),
  djName: text("dj_name").notNull(),
  sourceHash: text("source_hash").notNull(),
  canvaBrandTemplateId: text("canva_brand_template_id"),
  canvaDesignId: text("canva_design_id"),
  canvaEditUrl: text("canva_edit_url"),
  canvaViewUrl: text("canva_view_url"),
  driveFileId: text("drive_file_id"),
  driveLink: text("drive_link"),
  status: text("status").notNull().default("pending").$type<"pending" | "generated" | "failed">(),
  lastGeneratedAt: timestamp("last_generated_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertRadioTemplateAssetSchema = createInsertSchema(radioTemplateAssets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type RadioTemplateAsset = typeof radioTemplateAssets.$inferSelect;
export type InsertRadioTemplateAsset = z.infer<typeof insertRadioTemplateAssetSchema>;

// ==================== CANVA OAUTH TOKENS ====================

export const canvaOAuthTokens = pgTable("canva_oauth_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  scope: text("scope"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCanvaOAuthTokenSchema = createInsertSchema(canvaOAuthTokens).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CanvaOAuthToken = typeof canvaOAuthTokens.$inferSelect;
export type InsertCanvaOAuthToken = z.infer<typeof insertCanvaOAuthTokenSchema>;

// ==================== GOOGLE DRIVE OAUTH TOKENS ====================

export const googleDriveOAuthTokens = pgTable("google_drive_oauth_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  scope: text("scope"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertGoogleDriveOAuthTokenSchema = createInsertSchema(googleDriveOAuthTokens).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type GoogleDriveOAuthToken = typeof googleDriveOAuthTokens.$inferSelect;
export type InsertGoogleDriveOAuthToken = z.infer<typeof insertGoogleDriveOAuthTokenSchema>;

// ==================== AGENT ACTIONS (autonomous task execution) ====================

export const agentActions = pgTable("agent_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  type: text("type").notNull().$type<"radio_dj_search" | "radio_message_draft" | "portfolio_analysis" | "portfolio_rebalance" | "task_reminder" | "weekly_report">(),
  status: text("status").notNull().default("pending").$type<"pending" | "in_progress" | "completed" | "failed" | "needs_approval">(),
  description: text("description").notNull(),
  input: jsonb("input"), // input data for the action
  output: jsonb("output"), // result of the action
  requiresApproval: boolean("requires_approval").notNull().default(false),
  approvedAt: timestamp("approved_at"),
  executedAt: timestamp("executed_at"),
  scheduledFor: timestamp("scheduled_for"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentActionSchema = createInsertSchema(agentActions).omit({
  id: true,
  userId: true,
  status: true,
  approvedAt: true,
  executedAt: true,
  createdAt: true,
});

export type AgentAction = typeof agentActions.$inferSelect;
export type InsertAgentAction = z.infer<typeof insertAgentActionSchema>;

// ==================== TRUST & CONTROL LAYER ====================

export type TrustActorType = "user" | "assistant" | "system" | "scheduler" | "webhook";
export type TrustOrigin = "web" | "telegram" | "scheduler" | "api" | "github" | "system";
export type TrustExecutionMode = "user_requested" | "automated" | "scheduled" | "webhook";
export type AuditStatus =
  | "started"
  | "completed"
  | "failed"
  | "pending_approval"
  | "attempted"
  | "succeeded"
  | "blocked"
  | "queued";
export type PermissionLevel = "read_only" | "draft_only" | "execute_after_approval" | "autonomous";
export type PendingActionStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "edited"
  | "snoozed"
  | "executing"
  | "completed"
  | "executed"
  | "failed"
  | "cancelled"
  | "expired";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type PendingActionEventType =
  | "created"
  | "approved"
  | "rejected"
  | "edited"
  | "snoozed"
  | "executing"
  | "executed"
  | "failed"
  | "cancelled";

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  actorType: text("actor_type").notNull().$type<TrustActorType>(),
  actorId: text("actor_id"),
  origin: text("origin").notNull().$type<TrustOrigin>(),
  actionType: text("action_type").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  requestId: text("request_id"),
  pendingActionId: varchar("pending_action_id"),
  metadata: jsonb("metadata"),
  status: text("status").notNull().$type<AuditStatus>(),
  executionMode: text("execution_mode").notNull().$type<TrustExecutionMode>(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

export const pendingActions = pgTable("pending_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  createdByActorType: text("created_by_actor_type").notNull().$type<TrustActorType>(),
  createdByActorId: text("created_by_actor_id"),
  origin: text("origin").notNull().$type<TrustOrigin>(),
  actionType: text("action_type").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  riskLevel: text("risk_level").notNull().default("medium").$type<RiskLevel>(),
  permissionLevelRequired: text("permission_level_required").notNull().default("execute_after_approval").$type<PermissionLevel>(),
  status: text("status").notNull().default("pending").$type<PendingActionStatus>(),
  input: jsonb("input"),
  proposedChanges: jsonb("proposed_changes"),
  editedInput: jsonb("edited_input"),
  executionResult: jsonb("execution_result"),
  approvalReason: text("approval_reason"),
  rejectionReason: text("rejection_reason"),
  snoozedUntil: timestamp("snoozed_until"),
  expiresAt: timestamp("expires_at"),
  approvedBy: varchar("approved_by"),
  approvedAt: timestamp("approved_at"),
  executedAt: timestamp("executed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPendingActionSchema = createInsertSchema(pendingActions).omit({
  id: true,
  status: true,
  editedInput: true,
  executionResult: true,
  approvalReason: true,
  rejectionReason: true,
  snoozedUntil: true,
  approvedBy: true,
  approvedAt: true,
  executedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type PendingAction = typeof pendingActions.$inferSelect;
export type InsertPendingAction = z.infer<typeof insertPendingActionSchema>;

export const pendingActionEvents = pgTable("pending_action_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pendingActionId: varchar("pending_action_id").notNull().references(() => pendingActions.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  actorType: text("actor_type").notNull().$type<TrustActorType>(),
  actorId: text("actor_id"),
  eventType: text("event_type").notNull().$type<PendingActionEventType>(),
  previousStatus: text("previous_status").$type<PendingActionStatus>(),
  nextStatus: text("next_status").$type<PendingActionStatus>(),
  note: text("note"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPendingActionEventSchema = createInsertSchema(pendingActionEvents).omit({
  id: true,
  createdAt: true,
});

export type PendingActionEvent = typeof pendingActionEvents.$inferSelect;
export type InsertPendingActionEvent = z.infer<typeof insertPendingActionEventSchema>;

export const assistantPermissions = pgTable("assistant_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  scope: text("scope").notNull(),
  permissionLevel: text("permission_level").notNull().default("execute_after_approval").$type<PermissionLevel>(),
  riskLimit: text("risk_limit").notNull().default("medium").$type<RiskLevel>(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAssistantPermissionSchema = createInsertSchema(assistantPermissions).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export type AssistantPermission = typeof assistantPermissions.$inferSelect;
export type InsertAssistantPermission = z.infer<typeof insertAssistantPermissionSchema>;

// ==================== AUTOMATION MANAGER ====================

export type AutomationType =
  | "reminder"
  | "health_check"
  | "market_news"
  | "proactive_insight"
  | "flyer"
  | "clip"
  | "post"
  | "report"
  | "calendar_sync"
  | "portfolio_check"
  | "radio_check"
  | "agent_run";
export type AutomationStatus = "active" | "paused" | "failed" | "disabled";
export type AutomationRunStatus = "success" | "failed" | "skipped" | "pending_approval";

export const automationDefinitions = pgTable("automation_definitions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull().$type<AutomationType>(),
  ownerUserId: varchar("owner_user_id").notNull(),
  assignedAgentId: text("assigned_agent_id"),
  schedule: jsonb("schedule"),
  timezone: text("timezone").notNull().default("America/New_York"),
  status: text("status").notNull().default("active").$type<AutomationStatus>(),
  permissionLevel: text("permission_level").notNull().default("execute_after_approval").$type<PermissionLevel>(),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  nextRunAt: timestamp("next_run_at"),
  lastRunAt: timestamp("last_run_at"),
  lastStatus: text("last_status").$type<AutomationRunStatus>(),
  failureCount: integer("failure_count").notNull().default(0),
  costEstimate: text("cost_estimate"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAutomationDefinitionSchema = createInsertSchema(automationDefinitions).omit({
  id: true,
  ownerUserId: true,
  lastRunAt: true,
  lastStatus: true,
  failureCount: true,
  createdAt: true,
  updatedAt: true,
});

export type AutomationDefinition = typeof automationDefinitions.$inferSelect;
export type InsertAutomationDefinition = z.infer<typeof insertAutomationDefinitionSchema>;

export const automationRuns = pgTable("automation_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  automationId: varchar("automation_id").notNull().references(() => automationDefinitions.id, { onDelete: "cascade" }),
  ownerUserId: varchar("owner_user_id").notNull(),
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at"),
  status: text("status").notNull().$type<AutomationRunStatus>(),
  triggeredBy: text("triggered_by").notNull().$type<TrustActorType>(),
  resultSummary: text("result_summary"),
  errorMessage: text("error_message"),
  costEstimate: text("cost_estimate"),
  pendingActionId: varchar("pending_action_id"),
  auditLogId: varchar("audit_log_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAutomationRunSchema = createInsertSchema(automationRuns).omit({
  id: true,
  createdAt: true,
});

export type AutomationRun = typeof automationRuns.$inferSelect;
export type InsertAutomationRun = z.infer<typeof insertAutomationRunSchema>;

// ==================== REVENUE ENGINE STATE ====================

export const revenueEngineState = pgTable("revenue_engine_state", {
  ownerUserId: varchar("owner_user_id").notNull(),
  kind: text("kind").notNull(),
  data: jsonb("data").notNull().$type<unknown>(),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.ownerUserId, table.kind] }),
]);

export type RevenueEngineState = typeof revenueEngineState.$inferSelect;

// ==================== BLACKROOM REMOTE CONTROL ====================

export const blackRoomRemoteControl = pgTable("blackroom_remote_control", {
  id: varchar("id").primaryKey(),
  data: jsonb("data").notNull().$type<unknown>(),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ==================== DJ MESSAGE TEMPLATES ====================

export const djMessageTemplates = pgTable("dj_message_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  template: text("template").notNull(), // template with {{variables}}
  language: text("language").default("es"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDjMessageTemplateSchema = createInsertSchema(djMessageTemplates).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type DjMessageTemplate = typeof djMessageTemplates.$inferSelect;
export type InsertDjMessageTemplate = z.infer<typeof insertDjMessageTemplateSchema>;

// Scheduled Reminders - user-configured recurring notifications
export const scheduledReminders = pgTable("scheduled_reminders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  message: text("message").notNull(),
  hour: integer("hour").notNull(), // 0-23
  minute: integer("minute").notNull().default(0), // 0-59
  daysOfWeek: text("days_of_week").array(), // ["monday", "tuesday", ...] or null for every day
  isActive: boolean("is_active").notNull().default(true),
  lastSent: timestamp("last_sent"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertScheduledReminderSchema = createInsertSchema(scheduledReminders).omit({
  id: true,
  userId: true,
  lastSent: true,
  createdAt: true,
});

export type ScheduledReminder = typeof scheduledReminders.$inferSelect;
export type InsertScheduledReminder = z.infer<typeof insertScheduledReminderSchema>;
