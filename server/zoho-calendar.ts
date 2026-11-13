import { storage } from "./storage";
import { hasRealValue } from "./ceo-doctor-cli";

const ZOHO_ACCOUNTS_URL = "https://accounts.zoho.com";
const ZOHO_CALENDAR_URL = "https://calendar.zoho.com/api/v1";
interface ZohoTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  error?: string;
}

interface ZohoEvent {
  uid: string;
  title: string;
  dateandtime: {
    start: string;
    end: string;
    timezone: string;
  };
  location?: string;
  description?: string;
  isalldayevent?: boolean;
}

interface ZohoCalendar {
  uid: string;
  name: string;
  color?: string;
}

let cachedAccessToken: string | null = null;
let tokenExpiry: number = 0;

function getZohoCredentials() {
  const clientId = hasRealValue(process.env.ZOHO_CLIENT_ID) ? process.env.ZOHO_CLIENT_ID : "";
  const clientSecret = hasRealValue(process.env.ZOHO_CLIENT_SECRET) ? process.env.ZOHO_CLIENT_SECRET : "";
  const refreshToken = hasRealValue(process.env.ZOHO_REFRESH_TOKEN) ? process.env.ZOHO_REFRESH_TOKEN : "";
  return { clientId, clientSecret, refreshToken };
}

async function getAccessToken(): Promise<string | null> {
  const { clientId, clientSecret, refreshToken } = getZohoCredentials();
  if (!clientId || !clientSecret || !refreshToken) {
    console.log("Zoho Calendar credentials not configured");
    return null;
  }

  if (cachedAccessToken && Date.now() < tokenExpiry) {
    return cachedAccessToken;
  }

  try {
    const params = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    });

    const response = await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token?${params}`, {
      method: "POST",
    });

    const data: ZohoTokenResponse = await response.json();

    if (data.error) {
      console.error("Zoho token error:", data.error);
      return null;
    }

    cachedAccessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    
    return cachedAccessToken;
  } catch (error) {
    console.error("Error getting Zoho access token:", error);
    return null;
  }
}

async function getCalendars(): Promise<ZohoCalendar[]> {
  const accessToken = await getAccessToken();
  if (!accessToken) return [];

  try {
    const response = await fetch(`${ZOHO_CALENDAR_URL}/calendars`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    });

    const data = await response.json();
    return data.calendars || [];
  } catch (error) {
    console.error("Error fetching Zoho calendars:", error);
    return [];
  }
}

async function getEvents(calendarUid: string, startDate: Date, endDate: Date): Promise<ZohoEvent[]> {
  const accessToken = await getAccessToken();
  if (!accessToken) return [];

  try {
    const range = JSON.stringify({
      start: startDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
      end: endDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
    });

    const url = `${ZOHO_CALENDAR_URL}/calendars/${calendarUid}/events?range=${encodeURIComponent(range)}`;
    console.log(`[Zoho Events] Fetching: ${url}`);
    console.log(`[Zoho Events] Range param: ${range}`);

    const response = await fetch(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    });

    const data = await response.json();
    console.log(`[Zoho Events] Response status: ${response.status}, data:`, JSON.stringify(data).slice(0, 500));
    
    const events = data.events || [];
    const realEvents = events.filter((e: any) => e.uid && !e.message);
    console.log(`[Zoho Events] Found ${realEvents.length} real events (filtered from ${events.length})`);
    return realEvents;
  } catch (error) {
    console.error("Error fetching Zoho events:", error);
    return [];
  }
}

function parseZohoDate(dateStr: string, isAllDay: boolean): Date {
  if (isAllDay) {
    return new Date(dateStr.slice(0, 4) + '-' + dateStr.slice(4, 6) + '-' + dateStr.slice(6, 8));
  }
  
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  const hour = dateStr.slice(9, 11);
  const min = dateStr.slice(11, 13);
  const sec = dateStr.slice(13, 15);
  
  return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
}

export async function syncZohoCalendar(userId: string): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;

  const accessToken = await getAccessToken();
  if (!accessToken) {
    console.log("[Zoho Sync] No access token available");
    return { synced: 0, errors: ["Zoho Calendar no está conectado. Configura las credenciales."] };
  }

  try {
    const calendars = await getCalendars();
    console.log(`[Zoho Sync] Found ${calendars.length} calendars:`, calendars.map(c => c.name));
    
    if (calendars.length === 0) {
      return { synced: 0, errors: ["No se encontraron calendarios en Zoho"] };
    }

    const now = new Date();
    const overallStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const overallEndDate = new Date(now.getFullYear(), now.getMonth() + 3, 0);
    console.log(`[Zoho Sync] Overall date range: ${overallStartDate.toISOString()} to ${overallEndDate.toISOString()}`);

    for (const calendar of calendars) {
      try {
        const allEvents: ZohoEvent[] = [];
        let currentStart = new Date(overallStartDate);
        
        while (currentStart < overallEndDate) {
          const currentEnd = new Date(currentStart);
          currentEnd.setDate(currentEnd.getDate() + 30);
          if (currentEnd > overallEndDate) {
            currentEnd.setTime(overallEndDate.getTime());
          }
          
          const events = await getEvents(calendar.uid, currentStart, currentEnd);
          allEvents.push(...events);
          
          currentStart = new Date(currentEnd);
          currentStart.setDate(currentStart.getDate() + 1);
        }
        
        console.log(`[Zoho Sync] Calendar "${calendar.name}" returned ${allEvents.length} total events`);
        const events = allEvents;

        for (const event of events) {
          try {
            const externalId = `zoho_${event.uid}`;
            const existingTasks = await storage.getTasks(userId);
            const existing = existingTasks.find(t => t.externalId === externalId);

            const isAllDay = event.isalldayevent || false;
            const eventDate = parseZohoDate(event.dateandtime.start, isAllDay);
            const endDateParsed = event.dateandtime.end 
              ? parseZohoDate(event.dateandtime.end, isAllDay)
              : undefined;

            let description = event.description || "";
            if (event.location) {
              description = `📍 ${event.location}\n${description}`;
            }
            if (!isAllDay && event.dateandtime.start && event.dateandtime.end) {
              const startTime = eventDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
              const endTime = endDateParsed?.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
              description = `⏰ ${startTime} - ${endTime}\n${description}`;
            }

            const taskData = {
              title: event.title || "Sin título",
              date: eventDate,
              endDate: endDateParsed,
              priority: "medium" as const,
              type: "event" as const,
              completed: false,
              externalId,
              externalSource: "zoho",
              description: description.trim(),
            };

            if (existing) {
              await storage.updateTask(existing.id, taskData);
            } else {
              await storage.createTask(userId, taskData);
            }
            synced++;
          } catch (eventError) {
            errors.push(`Error procesando evento: ${event.title}`);
          }
        }
      } catch (calError) {
        errors.push(`Error en calendario: ${calendar.name}`);
      }
    }

    return { synced, errors };
  } catch (error) {
    return { synced: 0, errors: [`Error de sincronización: ${error}`] };
  }
}

export async function checkZohoConnection(): Promise<{ connected: boolean; email?: string }> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return { connected: false };
  }

  try {
    const calendars = await getCalendars();
    return { 
      connected: calendars.length > 0,
      email: calendars.length > 0 ? "Zoho Calendar conectado" : undefined 
    };
  } catch {
    return { connected: false };
  }
}

export function getZohoAuthUrl(redirectUri: string): string | null {
  const { clientId } = getZohoCredentials();
  if (!clientId) return null;
  
  const params = new URLSearchParams({
    scope: "ZohoCalendar.calendar.READ,ZohoCalendar.event.READ",
    client_id: clientId,
    response_type: "code",
    access_type: "offline",
    redirect_uri: redirectUri,
    prompt: "consent",
  });

  return `${ZOHO_ACCOUNTS_URL}/oauth/v2/auth?${params}`;
}

export async function exchangeZohoCode(code: string, redirectUri: string): Promise<{ refresh_token?: string; error?: string }> {
  const { clientId, clientSecret } = getZohoCredentials();
  if (!clientId || !clientSecret) {
    return { error: "Zoho credentials not configured" };
  }

  try {
    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });

    const response = await fetch(`${ZOHO_ACCOUNTS_URL}/oauth/v2/token?${params}`, {
      method: "POST",
    });

    const data = await response.json();
    
    if (data.error) {
      return { error: data.error };
    }

    return { refresh_token: data.refresh_token };
  } catch (error) {
    return { error: `Exchange error: ${error}` };
  }
}
