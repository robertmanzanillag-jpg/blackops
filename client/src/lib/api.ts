import { Task, InsertTask } from "@shared/schema";

export async function getTasks(): Promise<Task[]> {
  const response = await fetch("/api/tasks");
  if (!response.ok) throw new Error("Failed to fetch tasks");
  return response.json();
}

export async function createTask(task: InsertTask): Promise<Task> {
  const response = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task),
  });
  if (!response.ok) throw new Error("Failed to create task");
  return response.json();
}

export async function updateTask(id: string, updates: Partial<InsertTask>): Promise<Task> {
  const response = await fetch(`/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!response.ok) throw new Error("Failed to update task");
  return response.json();
}

export async function deleteTask(id: string): Promise<void> {
  const response = await fetch(`/api/tasks/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Failed to delete task");
}

export async function deleteTasksByTitle(title: string): Promise<{ deleted: number }> {
  const response = await fetch(`/api/tasks/by-title/${encodeURIComponent(title)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Failed to delete tasks");
  return response.json();
}

export interface CalendarStatus {
  google: boolean;
  zoho: boolean;
}

export async function getCalendarStatus(): Promise<CalendarStatus> {
  const response = await fetch("/api/calendar/status");
  if (!response.ok) throw new Error("Failed to fetch calendar status");
  return response.json();
}

export async function syncCalendar(): Promise<{ success: boolean; synced: number; total: number }> {
  const response = await fetch("/api/calendar/sync", {
    method: "POST",
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to sync calendar");
  }
  return response.json();
}

export async function syncZohoCalendar(): Promise<{ success: boolean; synced: number; errors: string[] }> {
  const response = await fetch("/api/calendar/zoho/sync", {
    method: "POST",
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to sync Zoho calendar");
  }
  return response.json();
}
