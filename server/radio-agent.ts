import { parseRadioDescription } from "../shared/radio-slots";
import {parseRadioSlotsWithPolicy} from "../shared/radio-slot-policies";
import {resolveSavedRadioPolicy} from "./office-radio-training";
import { storage } from "./storage";
import { sendTelegramMessage } from "./telegram";
import { format, addDays, endOfMonth, isAfter } from "date-fns";
import { es } from "date-fns/locale";
import type { Task, DjContact } from "@shared/schema";
import { getSystemUserId } from "./user-context";
import { hasRealValue } from "./ceo-doctor-cli";

function getTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return hasRealValue(token) ? token : null;
}

export interface RadioSlot {
  eventId: string;
  date: Date;
  dateStr: string;
  slot7: string | null;
  slot8: string | null;
  slot9: string | null;
  emptySlots: number[];
  rawDescription?: string | null;
  eventTitle?: string;
  weekday?: string;
  dayNumber?: number;
  ordinalDay?: string;
}

export interface RadioAnalysis {
  totalEvents: number;
  eventsWithEmptySlots: number;
  slotsToFill: { eventId: string; date: string; slots: number[] }[];
  upcomingEvents: RadioSlot[];
}

function isRadioEventTitle(title: string): boolean {
  const normalized = title.toLowerCase();
  return normalized.includes("radio") || normalized.includes("black room");
}

function getOrdinalDay(day: number): string {
  const lastTwo = day % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${day}TH`;

  switch (day % 10) {
    case 1:
      return `${day}ST`;
    case 2:
      return `${day}ND`;
    case 3:
      return `${day}RD`;
    default:
      return `${day}TH`;
  }
}

function buildRadioSlot(event: Task,policyVersion?:string): RadioSlot {
  const eventDate = new Date(event.date);
  const { slot7, slot8, slot9 } = policyVersion?parseRadioSlotsWithPolicy(policyVersion,event.description):parseRadioDescription(event.description);
  const emptySlots: number[] = [];

  if (!slot7) emptySlots.push(7);
  if (!slot8) emptySlots.push(8);
  if (!slot9) emptySlots.push(9);

  const dateStr = format(eventDate, "EEEE d 'de' MMMM", { locale: es });
  const weekday = format(eventDate, "EEEE").toUpperCase();
  const dayNumber = eventDate.getDate();

  return {
    eventId: event.externalId || event.id,
    date: eventDate,
    dateStr,
    slot7,
    slot8,
    slot9,
    emptySlots,
    rawDescription: event.description,
    eventTitle: event.title,
    weekday,
    dayNumber,
    ordinalDay: getOrdinalDay(dayNumber),
  };
}

export async function analyzeRadioEvents(userId = getSystemUserId()): Promise<RadioAnalysis> {
  const policyVersion=await resolveSavedRadioPolicy(userId);
  const tasks = await storage.getTasks(userId);
  const now = new Date();
  const monthEnd = endOfMonth(addDays(now, 60));

  const radioEvents = tasks
    .filter(t => isRadioEventTitle(t.title) && t.externalSource === "google" && isAfter(new Date(t.date), now))
    .filter(t => isAfter(monthEnd, new Date(t.date)))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const upcomingEvents: RadioSlot[] = [];
  const slotsToFill: { eventId: string; date: string; slots: number[] }[] = [];

  for (const event of radioEvents) {
    const radioSlot = buildRadioSlot(event,policyVersion);
    upcomingEvents.push(radioSlot);

    if (radioSlot.emptySlots.length > 0 && event.externalId) {
      slotsToFill.push({
        eventId: event.externalId,
        date: radioSlot.dateStr,
        slots: radioSlot.emptySlots,
      });
    }
  }

  return {
    totalEvents: radioEvents.length,
    eventsWithEmptySlots: slotsToFill.length,
    slotsToFill,
    upcomingEvents,
  };
}

export async function generateDjSuggestions(slotsNeeded: number, userId = getSystemUserId()): Promise<DjContact[]> {
  const availableDjs = await storage.getAvailableDjContacts(userId);
  
  const sortedDjs = availableDjs.sort((a, b) => {
    const aScore = (a.rating || 3) + (a.lastContacted ? -1 : 1);
    const bScore = (b.rating || 3) + (b.lastContacted ? -1 : 1);
    return bScore - aScore;
  });

  return sortedDjs.slice(0, slotsNeeded);
}

export async function generateDjMessage(dj: DjContact, eventDate: string, slot: number, userId = getSystemUserId()): Promise<string> {
  const template = await storage.getDefaultDjMessageTemplate(userId);
  
  const defaultTemplate = `Hola {{nombre}}! 👋

Te escribo de Black Room Radio. Tenemos un espacio disponible el {{fecha}} a las {{hora}}pm.

¿Te gustaría participar con un set? Sería genial tenerte.

Avísame si te interesa!`;

  const templateText = template?.template || defaultTemplate;
  
  return templateText
    .replace(/\{\{nombre\}\}/g, dj.name)
    .replace(/\{\{fecha\}\}/g, eventDate)
    .replace(/\{\{hora\}\}/g, String(slot))
    .replace(/\{\{instagram\}\}/g, dj.instagramHandle || "");
}

export async function createVideoEditTask(eventDate: Date, userId = getSystemUserId()): Promise<void> {
  const dayAfter = addDays(eventDate, 1);
  dayAfter.setHours(10, 0, 0, 0);
  
  const dateStr = format(eventDate, "d 'de' MMMM", { locale: es });
  
  await storage.createTask(userId, {
    title: `Editar videos Radio ${dateStr}`,
    date: dayAfter,
    priority: "high",
    type: "task",
    completed: false,
  });
}

export async function sendRadioSlotsSummary(userId = getSystemUserId()): Promise<{ sent: boolean; message: string }> {
  const config = await storage.getTelegramConfig(userId);
  if (!config || !config.enabled) {
    return { sent: false, message: "Telegram not configured" };
  }

  const analysis = await analyzeRadioEvents(userId);
  
  if (analysis.eventsWithEmptySlots === 0) {
    return { sent: false, message: "No empty slots found" };
  }

  let message = `📻 *RADIO - SLOTS VACÍOS*\n\n`;
  message += `Tienes ${analysis.eventsWithEmptySlots} eventos con slots por llenar:\n\n`;

  for (const event of analysis.slotsToFill.slice(0, 5)) {
    const slotsStr = event.slots.map(s => `${s}pm`).join(", ");
    message += `📅 *${event.date}*\n`;
    message += `   Slots vacíos: ${slotsStr}\n\n`;
  }

  const suggestedDjs = await generateDjSuggestions(3, userId);
  if (suggestedDjs.length > 0) {
    message += `\n🎧 *DJs disponibles para contactar:*\n`;
    for (const dj of suggestedDjs) {
      const instagram = dj.instagramHandle ? ` (@${dj.instagramHandle})` : "";
      const rating = dj.rating ? ` ⭐${dj.rating}` : "";
      message += `• ${dj.name}${instagram}${rating}\n`;
    }
  }

  const botToken = getTelegramBotToken();
  if (!botToken) {
    return { sent: false, message: "No bot token" };
  }

  await sendTelegramMessage(botToken, config.chatId, message);
  return { sent: true, message: `Sent summary with ${analysis.eventsWithEmptySlots} events with empty slots` };
}

export async function getRadioSlotsForMonth(userId = getSystemUserId()): Promise<RadioSlot[]> {
  const analysis = await analyzeRadioEvents(userId);
  return analysis.upcomingEvents;
}

export async function extractDjsFromRadioEvents(userId = getSystemUserId()): Promise<{ name: string; instagram?: string }[]> {
  const tasks = await storage.getTasks(userId);
  const radioEvents = tasks.filter(t => isRadioEventTitle(t.title) && t.externalSource === "google");
  
  const djSet = new Map<string, { name: string; instagram?: string }>();

  for (const event of radioEvents) {
    if (!event.description) continue;

    const parsed = parseRadioDescription(event.description);
    const names = [parsed.slot7, parsed.slot8, parsed.slot9].filter(Boolean) as string[];

    for (const djInfo of names) {
        const instagramMatch = djInfo.match(/@(\w+)/);
        const instagram = instagramMatch ? instagramMatch[1] : undefined;
        
        const name = djInfo
          .replace(/@\w+/g, '')
          .replace(/https?:\/\/[^\s]+/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        if (name.length > 0) {
          const key = name.toLowerCase();
          if (!djSet.has(key)) {
            djSet.set(key, { name, instagram });
          }
        }
    }
  }

  return Array.from(djSet.values());
}

export async function importDjsFromRadioHistory(userId = getSystemUserId()): Promise<{ imported: number; skipped: number }> {
  const extractedDjs = await extractDjsFromRadioEvents(userId);
  const existingDjs = await storage.getDjContacts(userId);
  const existingNames = new Set(existingDjs.map(d => d.name.toLowerCase()));

  let imported = 0;
  let skipped = 0;

  for (const dj of extractedDjs) {
    if (existingNames.has(dj.name.toLowerCase())) {
      skipped++;
      continue;
    }

    await storage.createDjContact(userId, {
      name: dj.name,
      instagramHandle: dj.instagram || null,
      status: "available",
    });
    imported++;
  }

  return { imported, skipped };
}
