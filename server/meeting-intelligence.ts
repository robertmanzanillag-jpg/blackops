import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { storage } from "./storage";

type MeetingSource = {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  source: string;
};

export type MeetingPrep = {
  id: string;
  title: string;
  startsAt: string;
  source: string;
  attendees: string[];
  context: string[];
  suggestedQuestions: string[];
  followUps: string[];
  risks: string[];
};

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function plain(value: string): string {
  return stripHtml(value).replace(/[<>]/g, "").trim();
}

function looksLikeMeeting(task: { title: string; description: string | null; type: string }): boolean {
  const text = `${task.title} ${task.description || ""}`.toLowerCase();
  return (
    task.type === "event" ||
    text.includes("meeting") ||
    text.includes("reunión") ||
    text.includes("reunion") ||
    text.includes("call") ||
    text.includes("sync") ||
    text.includes("demo") ||
    text.includes("review")
  );
}

function extractAttendees(title: string, description: string | null): string[] {
  const text = `${title}\n${description || ""}`;
  const attendees = new Set<string>();

  const emailMatches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  emailMatches.forEach((email) => attendees.add(email.toLowerCase()));

  const withMatches = text.match(/\b(?:con|with)\s+([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.-]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.-]+){0,2})/g) || [];
  withMatches.forEach((match) => attendees.add(match.replace(/^(con|with)\s+/i, "").trim()));

  return Array.from(attendees).slice(0, 6);
}

function keywordsFor(meeting: MeetingSource): string[] {
  const text = `${meeting.title} ${meeting.description || ""}`.toLowerCase();
  return text
    .replace(/[^a-z0-9áéíóúñ\s-]/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .filter((word) => !["para", "with", "meeting", "reunion", "reunión", "call", "sync", "este", "esta"].includes(word))
    .slice(0, 8);
}

export async function getUpcomingMeetingPreps(userId: string, limit = 5): Promise<MeetingPrep[]> {
  const tasks = await storage.getTasks(userId);
  const profile = await storage.getUserProfileData(userId);
  const today = startOfDay(new Date());
  const horizon = addDays(today, 7);

  const meetings: MeetingSource[] = tasks
    .filter((task) => {
      const date = new Date(task.date);
      return date >= today && date <= horizon && looksLikeMeeting(task);
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, limit)
    .map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      startsAt: new Date(task.date),
      endsAt: task.endDate ? new Date(task.endDate) : null,
      source: task.externalSource || "blackops",
    }));

  return meetings.map((meeting) => {
    const keywords = keywordsFor(meeting);
    const relatedTasks = tasks
      .filter((task) => {
        if (task.id === meeting.id || task.completed) return false;
        const text = `${task.title} ${task.description || ""}`.toLowerCase();
        return keywords.some((keyword) => text.includes(keyword));
      })
      .slice(0, 4);
    const relatedProfile = profile
      .filter((item) => keywords.some((keyword) => `${item.key} ${item.value}`.toLowerCase().includes(keyword)))
      .slice(0, 4);
    const dueFollowUps = tasks
      .filter((task) => task.type === "follow_up" && !task.completed && new Date(task.date) <= meeting.startsAt)
      .slice(0, 4);

    const context = [
      meeting.description ? plain(meeting.description).slice(0, 240) : null,
      ...relatedProfile.map((item) => `${item.key}: ${item.value}`),
      ...relatedTasks.map((task) => `Pendiente relacionado: ${task.title}`),
    ].filter(Boolean) as string[];

    const suggestedQuestions = [
      "¿Cuál es la decisión que debe salir de esta reunión?",
      "¿Quién queda como dueño del próximo paso?",
      "¿Qué bloqueo puede retrasar el resultado?",
    ];

    if (keywords.length > 0) {
      suggestedQuestions.push(`¿Qué cambia esta semana sobre ${keywords.slice(0, 2).join(" / ")}?`);
    }

    return {
      id: meeting.id,
      title: plain(meeting.title),
      startsAt: meeting.startsAt.toISOString(),
      source: meeting.source,
      attendees: extractAttendees(meeting.title, meeting.description),
      context: context.slice(0, 6),
      suggestedQuestions: suggestedQuestions.slice(0, 4),
      followUps: dueFollowUps.map((task) => task.title).slice(0, 4),
      risks: [
        relatedTasks.length > 0 ? `${relatedTasks.length} pendiente(s) relacionado(s) siguen abiertos.` : null,
        dueFollowUps.length > 0 ? `${dueFollowUps.length} follow-up(s) vencen antes de esta reunión.` : null,
        isSameDay(meeting.startsAt, new Date()) ? `Ocurre hoy a las ${format(meeting.startsAt, "HH:mm", { locale: es })}.` : null,
      ].filter(Boolean) as string[],
    };
  });
}

export async function getMeetingPrepById(userId: string, taskId: string): Promise<MeetingPrep | undefined> {
  const preps = await getUpcomingMeetingPreps(userId, 20);
  return preps.find((prep) => prep.id === taskId);
}
