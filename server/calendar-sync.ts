import { storage } from "./storage";
import { getCalendarEvents } from "./google-calendar";

export async function syncGoogleCalendarToTasks(userId: string): Promise<{ synced: number; updated: number; total: number }> {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);

  const twelveMonthsAhead = new Date();
  twelveMonthsAhead.setMonth(twelveMonthsAhead.getMonth() + 12);

  const events = await getCalendarEvents(weekStart, twelveMonthsAhead);
  const existingTasks = await storage.getTasks(userId);
  const existingByGoogleId = new Map(
    existingTasks
      .filter((task) => task.externalId && task.externalSource === "google")
      .map((task) => [task.externalId, task])
  );

  let synced = 0;
  let updated = 0;

  for (const event of events) {
    const existing = existingByGoogleId.get(event.id);

    if (!existing) {
      await storage.createTask(userId, {
        title: event.title,
        description: event.description || null,
        date: event.date,
        endDate: event.endDate || null,
        priority: "normal",
        completed: false,
        type: "event",
        externalId: event.id,
        externalSource: "google",
      });
      synced++;
      continue;
    }

    const nextDescription = event.description || null;
    const nextEndDate = event.endDate || null;
    const changed =
      existing.title !== event.title ||
      (existing.description || null) !== nextDescription ||
      new Date(existing.date).getTime() !== new Date(event.date).getTime() ||
      ((existing.endDate && new Date(existing.endDate).getTime()) || null) !== ((nextEndDate && new Date(nextEndDate).getTime()) || null) ||
      existing.type !== "event";

    if (changed) {
      await storage.updateTask(existing.id, {
        title: event.title,
        description: nextDescription,
        date: event.date,
        endDate: nextEndDate,
        priority: existing.priority || "normal",
        completed: existing.completed,
        type: "event",
        externalId: event.id,
        externalSource: "google",
      });
      updated++;
    }
  }

  return { synced, updated, total: events.length };
}
