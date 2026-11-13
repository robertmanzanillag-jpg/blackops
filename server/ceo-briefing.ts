import { addDays, endOfDay, startOfDay, startOfWeek } from "date-fns";
import { users as usersTable } from "@shared/schema";
import { db } from "./db";
import { storage } from "./storage";
import { getUpcomingMeetingPreps } from "./meeting-intelligence";
import { formatCeoMorningBrief, formatCeoRoutineCommand, plain, type CeoBriefSnapshot, type CeoRoutineCommand } from "./ceo-brief-format";

export async function loadCeoBriefSnapshot(userId: string): Promise<{ snapshot: CeoBriefSnapshot; now: Date }> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });

  const [
    tasks,
    weeklyTasks,
    monthlyGoals,
    yearlyGoals,
    pendingActions,
    projects,
    priceAlerts,
    investments,
    scheduledReminders,
    auditLogs,
    meetingPreps,
  ] = await Promise.all([
    storage.getTasks(userId),
    storage.getWeeklyTasks(userId, weekStart),
    storage.getMonthlyGoals(userId, new Date(now.getFullYear(), now.getMonth(), 1)),
    storage.getYearlyGoals(userId, String(now.getFullYear())),
    storage.getPendingActions(userId),
    storage.getMonitoredProjects(userId),
    storage.getPriceAlerts(userId),
    storage.getInvestments(userId),
    storage.getScheduledReminders(userId),
    storage.getAuditLogs(userId, 10),
    getUpcomingMeetingPreps(userId, 3),
  ]);

  const recentDecisions = (await storage.getUserProfileDataByCategory(userId, "decision")).slice(0, 5);
  const keyPeople = (await storage.getUserProfileDataByCategory(userId, "person")).slice(0, 5);
  const commitments = (await storage.getUserProfileDataByCategory(userId, "commitment")).slice(0, 6);
  const totalUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .then((rows) => rows.length);

  return {
    now,
    snapshot: {
    tasks,
    weeklyTasks,
    monthlyGoals,
    yearlyGoals,
    pendingActions,
    projects,
    priceAlerts,
    investments,
    scheduledReminders,
    auditLogs,
    meetingPreps,
    recentDecisions,
    keyPeople,
    commitments,
    totalUsers,
    },
  };
}

export async function generateCeoMorningBrief(userId: string): Promise<string> {
  const { snapshot, now } = await loadCeoBriefSnapshot(userId);
  return formatCeoMorningBrief(snapshot, now);
}

export async function generateCeoRoutineCommand(userId: string, command: CeoRoutineCommand): Promise<string> {
  const { snapshot, now } = await loadCeoBriefSnapshot(userId);
  return formatCeoRoutineCommand(command, snapshot, now);
}

export async function generateTelegramAssistantContext(userId: string): Promise<string> {
  const brief = await generateCeoMorningBrief(userId);
  const pendingActions = await storage.getPendingActions(userId);
  const recentDecisions = await storage.getUserProfileDataByCategory(userId, "decision");
  const keyPeople = await storage.getUserProfileDataByCategory(userId, "person");
  const commitments = await storage.getUserProfileDataByCategory(userId, "commitment");
  const pending = pendingActions.filter((action) => action.status === "pending" || action.status === "draft" || action.status === "edited").slice(0, 10);

  let context = `CONTEXTO CEO ACTUAL:\n${brief}`;
  if (pending.length > 0) {
    context += "\n\nACCIONES PENDIENTES DETALLADAS:\n";
    for (const action of pending) {
      context += `- ${action.id}: ${plain(action.title)} | ${action.actionType} | riesgo ${action.riskLevel}\n`;
    }
  }
  if (recentDecisions.length > 0) {
    context += "\n\nDECISIONES RECIENTES:\n";
    for (const decision of recentDecisions.slice(0, 8)) {
      context += `- ${plain(decision.key)}: ${plain(decision.value)}\n`;
    }
  }
  if (keyPeople.length > 0) {
    context += "\n\nPERSONAS CLAVE:\n";
    for (const person of keyPeople.slice(0, 8)) {
      context += `- ${plain(person.key)}: ${plain(person.value)}\n`;
    }
  }
  if (commitments.length > 0) {
    context += "\n\nCOMPROMISOS ABIERTOS:\n";
    for (const commitment of commitments.slice(0, 8)) {
      context += `- ${plain(commitment.key)}: ${plain(commitment.value)}\n`;
    }
  }

  return context;
}
