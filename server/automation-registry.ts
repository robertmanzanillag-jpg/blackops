import { storage } from "./storage";
import { listExistingAutomationDefinitions } from "./automation-definition-reads";
import { createPendingActionForApproval, writeAuditLog } from "./trust-policy";
import type { AutomationDefinition, AutomationRun, AutomationRunStatus, InsertAutomationDefinition, InsertAutomationRun } from "@shared/schema";

type AutomationSeed = InsertAutomationDefinition & {
  key: string;
};

const DEFAULT_TIMEZONE = "America/New_York";

export const DEFAULT_AUTOMATIONS: AutomationSeed[] = [
  {
    key: "morning-reminder",
    name: "Morning task reminder",
    description: "Sends Robert a morning summary of pending tasks.",
    type: "reminder",
    assignedAgentId: "blackops-scheduler",
    schedule: { kind: "daily_time", hour: 7, minute: 0 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "autonomous",
    requiresApproval: false,
    costEstimate: "0",
    metadata: { source: "server/reminder-scheduler.ts", function: "sendMorningReminder" },
  },
  {
    key: "evening-reminder",
    name: "Evening task review",
    description: "Sends Robert an evening reminder for incomplete tasks.",
    type: "reminder",
    assignedAgentId: "blackops-scheduler",
    schedule: { kind: "daily_time", hour: 21, minute: 0 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "autonomous",
    requiresApproval: false,
    costEstimate: "0",
    metadata: { source: "server/reminder-scheduler.ts", function: "sendEveningReminder" },
  },
  {
    key: "weekly-reminder",
    name: "Weekly task reminder",
    description: "Sends a Sunday weekly task reminder.",
    type: "reminder",
    assignedAgentId: "blackops-scheduler",
    schedule: { kind: "weekly_time", dayOfWeek: 0, hour: 18, minute: 0 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "autonomous",
    requiresApproval: false,
    costEstimate: "0",
    metadata: { source: "server/reminder-scheduler.ts", function: "sendWeeklyReminder" },
  },
  {
    key: "proactive-insights",
    name: "Proactive insights",
    description: "Analyzes tasks, goals, radio schedule, and portfolio context for useful nudges.",
    type: "proactive_insight",
    assignedAgentId: "blackops-assistant",
    schedule: { kind: "daily_time", hour: 8, minute: 0 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "execute_after_approval",
    requiresApproval: false,
    costEstimate: "low",
    metadata: { source: "server/proactive-insights.ts", function: "sendProactiveInsights" },
  },
  {
    key: "portfolio-news-digest",
    name: "Portfolio news digest",
    description: "Sends daily news related to holdings.",
    type: "market_news",
    assignedAgentId: "portfolio-agent",
    schedule: { kind: "daily_time", hour: 9, minute: 0 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "autonomous",
    requiresApproval: false,
    costEstimate: "low",
    metadata: { source: "server/reminder-scheduler.ts", function: "sendDailyNewsDigest" },
  },
  {
    key: "daily-market-update",
    name: "Daily market update",
    description: "Calculates portfolio summary, saves snapshot, and sends Telegram update.",
    type: "portfolio_check",
    assignedAgentId: "portfolio-agent",
    schedule: { kind: "daily_time", hour: 12, minute: 0 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "autonomous",
    requiresApproval: false,
    costEstimate: "low",
    metadata: { source: "server/market-news.ts", function: "sendDailyMarketUpdate" },
  },
  {
    key: "dropshipping-ceo-daily-operating-cycle",
    name: "Dropshipping CEO daily operating cycle",
    description: "Runs the dropshipping CEO internal daily cycle: analyzes metrics, prepares safe drafts, and queues next approved work without spending or publishing externally.",
    type: "agent_run",
    assignedAgentId: "dropshipping-ceo",
    schedule: { kind: "daily_time", hour: 7, minute: 20 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "autonomous",
    requiresApproval: false,
    costEstimate: "0",
    metadata: { source: "server/dropshipping-ceo.ts", function: "runDropshippingDailyOperatingCycle" },
  },
  {
    key: "dropshipping-ceo-morning-report",
    name: "Dropshipping CEO morning report",
    description: "Sends Robert the dropshipping CEO AM report with products, approvals, cash, spend, and next command.",
    type: "report",
    assignedAgentId: "dropshipping-ceo",
    schedule: { kind: "daily_time", hour: 7, minute: 30 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "autonomous",
    requiresApproval: false,
    costEstimate: "0",
    metadata: { source: "server/dropshipping-ceo.ts", function: "sendDropshippingDailyReport", cadence: "morning" },
  },
  {
    key: "dropshipping-ceo-evening-report",
    name: "Dropshipping CEO evening close",
    description: "Sends Robert the dropshipping CEO PM close with sales, products, content drafts, approvals, and learning.",
    type: "report",
    assignedAgentId: "dropshipping-ceo",
    schedule: { kind: "daily_time", hour: 21, minute: 0 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "autonomous",
    requiresApproval: false,
    costEstimate: "0",
    metadata: { source: "server/dropshipping-ceo.ts", function: "sendDropshippingDailyReport", cadence: "evening" },
  },
  {
    key: "metricool-daily-analytics-sync",
    name: "Metricool daily analytics sync",
    description: "Pulls Metricool Facebook post analytics for Miami News and NY News once per day into the local-news CEO learning loop. X remains disabled until explicitly connected.",
    type: "agent_run",
    assignedAgentId: "marketing-agent",
    schedule: { kind: "daily_time", hour: 6, minute: 45 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "autonomous",
    requiresApproval: false,
    costEstimate: "low",
    metadata: { source: "server/metricool-analytics-sync.ts", function: "syncMetricoolAnalytics", key: "metricool-daily-analytics-sync", requiresEnv: ["METRICOOL_USER_TOKEN", "METRICOOL_USER_ID"], networks: ["facebook"], xEnabled: false },
  },
  {
    key: "clippers-local-news-cycle",
    name: "Clippers local news cycle",
    description: "Runs the Miami News and NY News intake cycle every five minutes. Intake stays active; external delivery remains blocked until the matching Metricool brand and Facebook/X profile are connected.",
    type: "agent_run",
    assignedAgentId: "clippers-agent",
    schedule: { kind: "interval", everyMinutes: 5 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "autonomous",
    requiresApproval: false,
    costEstimate: "0",
    metadata: {
      source: "server/clippers-local-news-agent.ts",
      function: "runClipperLocalNewsCycle",
      requiresMetricoolConnection: true,
      brandIds: ["winner-account-1", "winner-account-2"],
    },
  },
  {
    key: "health-checks",
    name: "Project health checks",
    description: "Checks monitored projects every minute and sends alerts on incidents.",
    type: "health_check",
    assignedAgentId: "monitor-agent",
    schedule: { kind: "interval", everyMinutes: 1 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "autonomous",
    requiresApproval: false,
    costEstimate: "0",
    metadata: { source: "server/health-check.ts", function: "checkAllProjects" },
  },
  {
    key: "app-qa-council",
    name: "Bug Patrol + App QA Daily Report",
    description: "Checks app routes, GitHub repos, health endpoints, runtime errors, creates Codex PR-first handoffs for real bugs, sends urgent alerts, and sends the daily QA summary.",
    type: "agent_run",
    assignedAgentId: "app-qa",
    schedule: { kind: "interval", everyMinutes: 30 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "autonomous",
    requiresApproval: false,
    costEstimate: "0",
    metadata: { source: "server/app-qa-agent.ts", function: "runAppQaScan", bugPatrol: true, codexHandoff: "pr_first", digest: "daily" },
  },
  {
    key: "radio-slot-check",
    name: "Radio scheduling check",
    description: "Checks upcoming Radio slots and notifies missing DJs.",
    type: "radio_check",
    assignedAgentId: "radio-agent",
    schedule: { kind: "weekly_time", dayOfWeek: 1, hour: 8, minute: 0 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "execute_after_approval",
    requiresApproval: false,
    costEstimate: "low",
    metadata: { source: "server/agent-actions.ts", actionId: "radio_notify_slots" },
  },
  {
    key: "portfolio-weekly-report",
    name: "Portfolio weekly report",
    description: "Generates and sends a weekly portfolio report.",
    type: "report",
    assignedAgentId: "portfolio-agent",
    schedule: { kind: "weekly_time", dayOfWeek: 0, hour: 10, minute: 0 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "execute_after_approval",
    requiresApproval: true,
    costEstimate: "low",
    metadata: { source: "server/agent-actions.ts", actionId: "portfolio_weekly_report" },
  },
  {
    key: "video-edit-task-check",
    name: "Video edit task check",
    description: "Creates video edit tasks after Radio events.",
    type: "agent_run",
    assignedAgentId: "blackops-scheduler",
    schedule: { kind: "weekly_time", dayOfWeek: 5, hour: 10, minute: 0 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "execute_after_approval",
    requiresApproval: true,
    costEstimate: "0",
    metadata: { source: "server/agent-actions.ts", actionId: "create_video_edit_task" },
  },
  {
    key: "calendar-sync",
    name: "Calendar sync",
    description: "Manual sync of Google/Zoho calendar into local tasks.",
    type: "calendar_sync",
    assignedAgentId: "calendar-agent",
    schedule: { kind: "manual" },
    timezone: DEFAULT_TIMEZONE,
    status: "paused",
    permissionLevel: "execute_after_approval",
    requiresApproval: true,
    costEstimate: "0",
    metadata: { source: "server/routes.ts", endpoints: ["/api/calendar/sync", "/api/calendar/zoho/sync"] },
  },
  {
    key: "radio-template-generation",
    name: "Radio template generation",
    description: "Generates same-day downloadable Radio DJ templates and uploads them to Google Drive.",
    type: "flyer",
    assignedAgentId: "creative-agent",
    schedule: { kind: "daily_time", hour: 8, minute: 15 },
    timezone: DEFAULT_TIMEZONE,
    status: "active",
    permissionLevel: "autonomous",
    requiresApproval: false,
    costEstimate: "medium",
    metadata: { source: "server/radio-template-agent.ts", function: "generateRadioTemplatesForDate" },
  },
  {
    key: "clip-generation",
    name: "Clip generation",
    description: "Future automation slot for creating clips from content/media.",
    type: "clip",
    assignedAgentId: "creative-agent",
    schedule: { kind: "manual" },
    timezone: DEFAULT_TIMEZONE,
    status: "disabled",
    permissionLevel: "draft_only",
    requiresApproval: true,
    costEstimate: "medium",
    metadata: { future: true },
  },
  {
    key: "post-publishing",
    name: "Post publishing",
    description: "Future automation slot for posts. Disabled until content approval flow is designed.",
    type: "post",
    assignedAgentId: "marketing-agent",
    schedule: { kind: "manual" },
    timezone: DEFAULT_TIMEZONE,
    status: "disabled",
    permissionLevel: "draft_only",
    requiresApproval: true,
    costEstimate: "medium",
    metadata: { future: true },
  },
];

export async function ensureDefaultAutomations(userId: string): Promise<AutomationDefinition[]> {
  // Compatibility export only: initialization is no longer implicit.
  // Explicit default registration remains pending, not part of GET/startup/run.
  return getExistingAutomations(userId);
}

export function getExistingAutomations(userId: string): Promise<AutomationDefinition[]> {
  return listExistingAutomationDefinitions(storage, userId);
}

export function getNextRunAt(schedule: unknown): Date | null {
  if (!schedule || typeof schedule !== "object") return null;
  const data = schedule as Record<string, any>;
  const now = new Date();

  if (data.kind === "interval" && Number(data.everyMinutes) > 0) {
    return new Date(now.getTime() + Number(data.everyMinutes) * 60 * 1000);
  }

  if (data.kind === "daily_time") {
    const target = new Date(now);
    target.setHours(Number(data.hour || 0), Number(data.minute || 0), 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target;
  }

  if (data.kind === "weekly_time") {
    const target = new Date(now);
    const targetDay = Number(data.dayOfWeek || 0);
    const daysUntil = (targetDay - target.getDay() + 7) % 7;
    target.setDate(target.getDate() + daysUntil);
    target.setHours(Number(data.hour || 0), Number(data.minute || 0), 0, 0);
    if (target <= now) target.setDate(target.getDate() + 7);
    return target;
  }

  return null;
}

export async function recordManualAutomationRun(
  automation: AutomationDefinition,
  actorId: string
): Promise<AutomationRun> {
  const startedAt = new Date();
  const isRunnable = automation.status === "active" || automation.status === "paused";

  if (!isRunnable) {
    const audit = await writeAuditLog({
      userId: automation.ownerUserId,
      actorType: "user",
      actorId,
      origin: "web",
      actionType: "automation.manual_run",
      resourceType: "automation",
      resourceId: automation.id,
      metadata: { status: automation.status },
      status: "blocked",
      executionMode: "user_requested",
      errorMessage: "Automation is disabled or failed",
    });

    return storage.createAutomationRun({
      automationId: automation.id,
      ownerUserId: automation.ownerUserId,
      startedAt,
      finishedAt: new Date(),
      status: "skipped",
      triggeredBy: "user",
      resultSummary: "Automation is not runnable in its current status.",
      errorMessage: "Automation is disabled or failed",
      costEstimate: automation.costEstimate,
      auditLogId: audit.id,
      metadata: { automationStatus: automation.status },
    });
  }

  if (automation.requiresApproval || automation.permissionLevel !== "autonomous") {
    const pendingAction = await createPendingActionForApproval({
      userId: automation.ownerUserId,
      actorType: "user",
      actorId,
      origin: "web",
      executionMode: "user_requested",
      actionType: "automation.manual_run",
      resourceType: "automation",
      resourceId: automation.id,
      title: `Run automation: ${automation.name}`,
      description: automation.description || "Manual automation run requires approval.",
      input: {
        automationId: automation.id,
        automationName: automation.name,
        type: automation.type,
      },
      proposedChanges: {
        run: true,
        schedule: automation.schedule,
      },
      metadata: { automationType: automation.type },
      scope: "system",
    });

    return storage.createAutomationRun({
      automationId: automation.id,
      ownerUserId: automation.ownerUserId,
      startedAt,
      finishedAt: new Date(),
      status: "pending_approval",
      triggeredBy: "user",
      resultSummary: "Manual run queued for approval.",
      costEstimate: automation.costEstimate,
      pendingActionId: pendingAction.id,
      metadata: { automationType: automation.type },
    });
  }

  const audit = await writeAuditLog({
    userId: automation.ownerUserId,
    actorType: "user",
    actorId,
    origin: "web",
    actionType: "automation.manual_run",
    resourceType: "automation",
    resourceId: automation.id,
    metadata: { automationType: automation.type },
    status: "queued",
    executionMode: "user_requested",
  });

  return storage.createAutomationRun({
    automationId: automation.id,
    ownerUserId: automation.ownerUserId,
    startedAt,
    finishedAt: new Date(),
    status: "skipped",
    triggeredBy: "user",
    resultSummary: "Manual run recorded. Direct execution will be wired in the scheduler integration phase.",
    costEstimate: automation.costEstimate,
    auditLogId: audit.id,
    metadata: { automationType: automation.type, directExecutionWired: false },
  });
}

export type ScheduledAutomationRunOutcome = {
  status: AutomationRunStatus;
  resultSummary: string;
  errorMessage?: string | null;
  metadata?: InsertAutomationRun["metadata"];
};

export function buildScheduledAutomationRunInput(input: {
  automation: AutomationDefinition;
  startedAt: Date;
  finishedAt: Date;
  outcome: ScheduledAutomationRunOutcome;
}): InsertAutomationRun {
  return {
    automationId: input.automation.id,
    ownerUserId: input.automation.ownerUserId,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    status: input.outcome.status,
    triggeredBy: "scheduler",
    resultSummary: input.outcome.resultSummary,
    errorMessage: input.outcome.errorMessage || null,
    costEstimate: input.automation.costEstimate,
    pendingActionId: null,
    auditLogId: null,
    metadata: input.outcome.metadata || null,
  };
}

export async function recordScheduledAutomationRun(
  userId: string,
  automationKey: string,
  startedAt: Date,
  outcome: ScheduledAutomationRunOutcome,
): Promise<AutomationRun | null> {
  const automations = await getExistingAutomations(userId);
  const automation = automations.find((item) => (item.metadata as any)?.key === automationKey);
  if (!automation) return null;

  return storage.createAutomationRun(buildScheduledAutomationRunInput({
    automation,
    startedAt,
    finishedAt: new Date(),
    outcome,
  }));
}
